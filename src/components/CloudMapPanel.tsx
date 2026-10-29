import { useEffect, useMemo, useRef, useState } from 'react';
import { getColorScale, getValueFromLatLong, omProtocol } from '@openmeteo/weather-map-layer';
import type { ModelId } from '../lib/forecast';
import { PIN_OFFSET, TILE_CONFIG, TILE_IDS, createPinMarker, maplibregl, type TileLayerId } from '../lib/maplibre';
import { scoreColor } from '../lib/score';
import {
  CLOUD_LAYERS,
  SPATIAL_MODELS,
  buildOmTileUrl,
  fetchSpatialMeta,
  nearestValidTime,
  type CloudLayerVar,
  type SpatialDomainId,
  type SpatialMeta,
} from '../lib/spatial';
import { formatLatLon, type Place } from '../lib/storage';
import { HOUR_MS, formatDateShort, formatHM, formatTime, jstNoon, toDateKey, type DateKey } from '../lib/time';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useForecasts } from '../lib/useForecasts';
import { CardTitle, Icon } from './Icon';

// om:// プロトコルを MapLibre に 1 度だけ登録する
let omProtocolRegistered = false;
function ensureOmProtocol() {
  if (!omProtocolRegistered) {
    maplibregl.addProtocol('om', omProtocol);
    omProtocolRegistered = true;
  }
}

interface Props {
  dateKey: DateKey;
  places: Place[];
  currentPlace: Place;
  selectedId: string;
  onSelectPlace: (id: string) => void;
}

/** 雲量レイヤー（ソース ID もレイヤー ID と同じ）は `om-cloud-<連番>` で管理する */
const OM_PREFIX = 'om-cloud-';
const omSeqOf = (id: string) => Number(id.slice(OM_PREFIX.length));

/** 登録地点マーカーに全4層（全雲量・上層・中層・下層）の指定時刻の雲量%を表示するために4層を取得 */
const CLOUD_MARKER_VARS = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'] as const;

/**
 * ベース地図タイルと雲量オーバーレイの両方を 1 つのスタイル定義にまとめる。
 * こうすることで、ベース地図を切り替えたときにも雲量レイヤーが途切れず一緒に再描画される。
 */
function buildCloudMapStyle(
  layerId: TileLayerId,
  om: { id: string; url: string } | null,
  opacity: number,
): maplibregl.StyleSpecification {
  const cfg = TILE_CONFIG[layerId];
  const sources: maplibregl.StyleSpecification['sources'] = {
    base: {
      type: 'raster',
      tiles: cfg.tiles,
      tileSize: 256,
      attribution: cfg.attribution,
      maxzoom: cfg.maxzoom,
    },
  };
  const layers: maplibregl.StyleSpecification['layers'] = [
    {
      id: 'base-layer',
      type: 'raster',
      source: 'base',
    },
  ];
  if (om) {
    sources[om.id] = {
      type: 'raster',
      url: om.url,
      maxzoom: 12,
    };
    layers.push({
      id: om.id,
      type: 'raster',
      source: om.id,
      paint: {
        'raster-opacity': opacity,
        'raster-fade-duration': 200,
      },
    });
  }
  return { version: 8, sources, layers };
}

/** 現在のスタイルに含まれる雲量レイヤー ID（連番の昇順） */
function omLayerIds(map: maplibregl.Map): string[] {
  try {
    return (map.getStyle()?.layers ?? [])
      .map((l) => l.id)
      .filter((id) => id.startsWith(OM_PREFIX))
      .sort((a, b) => omSeqOf(a) - omSeqOf(b));
  } catch {
    return [];
  }
}

/** keepId より古い雲量レイヤーとソースを取り除く */
function removeOlderOmLayers(map: maplibregl.Map, keepId: string) {
  const keepSeq = omSeqOf(keepId);
  for (const id of omLayerIds(map)) {
    if (omSeqOf(id) >= keepSeq) continue;
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
}

interface ProbePoint {
  lat: number;
  lon: number;
  /** 選択中の層の雲量 (%) */
  activeValue: number | null;
  /** 全4層の雲量 (%) */
  allLayers: Partial<Record<CloudLayerVar, number | null>>;
  loading: boolean;
}

/** SCW風の面的な雲量マップ専用パネル */
export function CloudMapPanel({ dateKey, places, currentPlace, selectedId, onSelectPlace }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const probeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const appliedTileRef = useRef<TileLayerId>('osm');
  /** 表示中（最新）の雲量レイヤー */
  const omActiveRef = useRef<{ id: string; url: string } | null>(null);
  const omSeqRef = useRef(0);
  const probeSeqRef = useRef(0);

  const [tileId, setTileId] = useState<TileLayerId>('osm');
  const [mapReady, setMapReady] = useState(false);

  const [spatialDomain, setSpatialDomain] = useState<SpatialDomainId>('jma_msm');
  const [cloudVar, setCloudVar] = useState<CloudLayerVar>('cloud_cover');
  const [cloudOpacity, setCloudOpacity] = useState(0.78);
  // メタ情報はどのモデルのものかと一緒に持ち、モデル切替直後に別モデルの初期時刻で URL を組まないようにする
  const [spatial, setSpatial] = useState<{ domain: SpatialDomainId; meta: SpatialMeta } | null>(null);
  const spatialMeta = spatial?.domain === spatialDomain ? spatial.meta : null;
  const [spatialError, setSpatialError] = useState<string | null>(null);
  const [validTimeMs, setValidTimeMs] = useState<number | null>(null);

  // クリックした地点の雲量読み取り状態
  const [probe, setProbe] = useState<ProbePoint | null>(null);

  const allPlaces = useMemo(() => (places.length > 0 ? places : [currentPlace]), [places, currentPlace]);
  const { data: forecasts } = useForecasts(allPlaces, CLOUD_MARKER_VARS);

  const defaultTargetMs = (key: DateKey) => jstNoon(key).getTime() + 9 * HOUR_MS; // 21:00 JST

  const omUrlNow =
    spatialMeta && validTimeMs != null && spatialMeta.validTimes.includes(validTimeMs)
      ? buildOmTileUrl(spatialDomain, spatialMeta, validTimeMs, cloudVar, true)
      : null;
  // スライダーをドラッグしている間は読み込みを連発せず、止まった時刻のデータだけを取りに行く
  const omUrl = useDebouncedValue(omUrlNow, 140);

  const omUrlRef = useRef<string | null>(null);
  omUrlRef.current = omUrl;
  const opacityRef = useRef(cloudOpacity);
  opacityRef.current = cloudOpacity;
  const cloudVarRef = useRef<CloudLayerVar>(cloudVar);
  cloudVarRef.current = cloudVar;
  const validTimeRef = useRef<number | null>(validTimeMs);
  validTimeRef.current = validTimeMs;
  const domainRef = useRef<SpatialDomainId>(spatialDomain);
  domainRef.current = spatialDomain;

  useEffect(() => {
    let alive = true;
    setSpatialError(null);
    fetchSpatialMeta(spatialDomain)
      .then((meta) => {
        if (!alive) return;
        setSpatial({ domain: spatialDomain, meta });
        setValidTimeMs((prev) => nearestValidTime(meta.validTimes, prev ?? defaultTargetMs(dateKey)));
      })
      .catch((e: Error) => {
        if (!alive) return;
        setSpatialError(e.message);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatialDomain]);

  useEffect(() => {
    if (!spatialMeta) return;
    setValidTimeMs(nearestValidTime(spatialMeta.validTimes, defaultTargetMs(dateKey)));
  }, [dateKey, spatialMeta]);

  // 指定座標の雲量を読み取る（1. まず読み込み済み .om メモリから即座に取得、2. 全4層は Open-Meteo API でも補完）
  const probeAt = async (lat: number, lon: number) => {
    // 連続で読み取ったとき、古い読み取り結果で新しい結果を上書きしないための連番
    const seq = ++probeSeqRef.current;
    setProbe({ lat, lon, activeValue: null, allLayers: {}, loading: true });

    let sampled: number | null = null;
    const currentUrl = omUrlRef.current;
    if (currentUrl && mapRef.current) {
      try {
        const res = await getValueFromLatLong(lat, lon, currentUrl, mapRef.current.getZoom());
        if (Number.isFinite(res.value)) {
          sampled = Math.max(0, Math.min(100, Math.round(res.value)));
        }
      } catch {
        // タイル未ロード領域の場合は下の API フォールバックで補う
      }
    }

    // 選択中のモデルの全4層の雲量を Open-Meteo からピンポイント取得して補完
    const modelParam =
      domainRef.current === 'jma_msm' || domainRef.current === 'jma_seamless'
        ? 'jma_msm'
        : domainRef.current === 'ecmwf_ifs'
          ? 'ecmwf_ifs'
          : domainRef.current === 'ncep_gfs013'
            ? 'gfs_seamless'
            : 'icon_seamless';

    const allLayers: Partial<Record<CloudLayerVar, number | null>> = {};
    if (sampled != null) {
      allLayers[cloudVarRef.current] = sampled;
    }

    try {
      const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&models=${modelParam}&timeformat=unixtime&timezone=Asia%2FTokyo&past_days=1&forecast_days=5`;
      const r = await fetch(apiUrl);
      if (r.ok) {
        const j = (await r.json()) as { hourly?: Record<string, (number | null)[]> & { time?: number[] } };
        const times = (j.hourly?.time ?? []).map((t) => t * 1000);
        const target = validTimeRef.current ?? Date.now();
        let bestIdx = 0;
        let bestDiff = Infinity;
        times.forEach((t, i) => {
          const d = Math.abs(t - target);
          if (d < bestDiff) {
            bestDiff = d;
            bestIdx = i;
          }
        });
        for (const layer of CLOUD_LAYERS) {
          const arr = j.hourly?.[`${layer.id}_${modelParam}`] ?? j.hourly?.[layer.id];
          const v = arr?.[bestIdx];
          if (v != null && Number.isFinite(v)) {
            allLayers[layer.id] = Math.round(v);
          }
        }
        if (sampled == null && allLayers[cloudVarRef.current] != null) {
          sampled = allLayers[cloudVarRef.current]!;
        }
      }
    } catch {
      /* noop */
    }

    if (seq !== probeSeqRef.current) return;
    setProbe({
      lat,
      lon,
      activeValue: sampled,
      allLayers,
      loading: false,
    });
  };

  useEffect(() => {
    ensureOmProtocol();
    if (!containerRef.current) return;
    const selected = allPlaces.find((p) => p.id === selectedId) ?? currentPlace;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildCloudMapStyle(appliedTileRef.current, null, opacityRef.current),
      center: [selected.lon, selected.lat],
      zoom: 6.2,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => setMapReady(true));
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      const lat = Number(e.lngLat.lat.toFixed(4));
      const lon = Number(e.lngLat.lng.toFixed(4));
      probeAt(lat, lon);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      omActiveRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ベース地図の切替：表示中の雲量レイヤーを同じ ID のままスタイルに含めるので、雲は読み直されず途切れない
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || appliedTileRef.current === tileId) return;
    appliedTileRef.current = tileId;
    map.setStyle(buildCloudMapStyle(tileId, omActiveRef.current, opacityRef.current));
  }, [mapReady, tileId]);

  // 雲量データ（モデル・層・時刻）の切替：新しいレイヤーを上に重ね、読み込みが終わってから古いレイヤーを外す。
  // 先に古いレイヤーを消すと、読み込み中に雲が一瞬消えてチラつくため。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !omUrl || omActiveRef.current?.url === omUrl) return;

    const id = `${OM_PREFIX}${++omSeqRef.current}`;
    const add = () => {
      map.addSource(id, { type: 'raster', url: omUrl, maxzoom: 12 });
      map.addLayer({
        id,
        type: 'raster',
        source: id,
        paint: { 'raster-opacity': opacityRef.current, 'raster-fade-duration': 200 },
      });
      omActiveRef.current = { id, url: omUrl };
    };
    try {
      add();
    } catch {
      // スタイルの読み込み途中なら完了を待ってから追加する
      map.once('idle', () => {
        if (omSeqRef.current === omSeqOf(id)) add();
      });
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off('sourcedata', onSourceData);
      clearTimeout(timer);
      if (map.getLayer(id)) removeOlderOmLayers(map, id);
    };
    const onSourceData = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId === id && map.getSource(id) && map.isSourceLoaded(id)) finish();
    };
    map.on('sourcedata', onSourceData);
    // 通信が遅い場合でも古いレイヤーを残し続けない
    const timer = setTimeout(finish, 6000);
  }, [mapReady, omUrl]);

  // 不透明度の変更はレイヤーを作り直さずに paint プロパティだけ即時反映
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const id of omLayerIds(map)) {
      map.setPaintProperty(id, 'raster-opacity', cloudOpacity);
    }
  }, [mapReady, cloudOpacity]);

  // 層・時刻・モデルが変わったときに、選択中のプローブ地点があれば値も更新
  useEffect(() => {
    if (probe && omUrl) {
      probeAt(probe.lat, probe.lon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omUrl]);

  // プローブ地点のピンマーカー表示
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (probeMarkerRef.current) {
      probeMarkerRef.current.remove();
      probeMarkerRef.current = null;
    }
    if (!probe) return;

    const layerLabel = CLOUD_LAYERS.find((l) => l.id === cloudVar)?.label ?? '雲量';
    const el = document.createElement('div');
    el.className = 'probe-marker';
    const valText = probe.loading ? '…' : probe.activeValue == null ? '—%' : `${probe.activeValue}%`;
    // innerHTML を使わず DOM を組み立てる（値は定数と数値だけだが、文字列を HTML として解釈させない）
    const val = document.createElement('span');
    val.className = 'probe-val';
    const b = document.createElement('b');
    b.textContent = valText;
    val.append(`${layerLabel}: `, b);
    const dot = document.createElement('span');
    dot.className = 'probe-dot';
    el.append(val, dot);

    probeMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, 5] })
      .setLngLat([probe.lon, probe.lat])
      .addTo(map);
  }, [probe, cloudVar]);

  useEffect(() => {
    if (!mapRef.current) return;
    const selected = [currentPlace, ...places].find((p) => p.id === selectedId);
    if (selected) {
      mapRef.current.flyTo({ center: [selected.lon, selected.lat], duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // 登録地点のマーカー（選択中のレイヤー・モデル・指定時刻における雲量%を表示）
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const modelKey: ModelId =
      spatialDomain === 'jma_msm' || spatialDomain === 'jma_seamless'
        ? 'jma_msm'
        : spatialDomain === 'ecmwf_ifs'
          ? 'ecmwf_ifs'
          : spatialDomain === 'ncep_gfs013'
            ? 'gfs_seamless'
            : 'icon_seamless';

    allPlaces.forEach((p, idx) => {
      const fc = forecasts?.[idx];
      let cloudPct: number | null = null;
      if (fc && validTimeMs != null && fc.time.length > 0) {
        let bestIdx = 0;
        let bestDiff = Infinity;
        fc.time.forEach((t, i) => {
          const d = Math.abs(t - validTimeMs);
          if (d < bestDiff) {
            bestDiff = d;
            bestIdx = i;
          }
        });
        // 3時間以内の時刻ステップがあればその雲量を採用（MSM期間外で jma_seamless の場合は ecmwf_ifs 等へフォールバック）
        if (bestDiff <= 3 * HOUR_MS) {
          const v =
            fc.series[cloudVar]?.[modelKey]?.[bestIdx] ??
            (spatialDomain === 'jma_seamless' ? fc.series[cloudVar]?.ecmwf_ifs?.[bestIdx] : null);
          if (v != null && Number.isFinite(v)) {
            cloudPct = Math.round(v);
          }
        }
      }

      // 雲量 0%（快晴）ほど緑、100%（曇天）ほど赤になるよう (100 - cloudPct) で色付け
      const badgeColor = scoreColor(cloudPct == null ? null : 100 - cloudPct);

      const el = createPinMarker({
        label: p.name,
        badge: cloudPct == null ? '—' : `${cloudPct}%`,
        color: badgeColor,
        active: p.id === selectedId,
        onClick: () => onSelectPlace(p.id),
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: PIN_OFFSET }).setLngLat([p.lon, p.lat]).addTo(map);
      markersRef.current.push(marker);
    });
  }, [allPlaces, forecasts, spatialDomain, cloudVar, validTimeMs, selectedId, onSelectPlace]);

  // モデル切替でメタ情報を取り直している間も、直前のスライダーを表示したままにしてレイアウトを揺らさない
  const displayMeta = spatialMeta ?? spatial?.meta ?? null;
  const validTimes = displayMeta?.validTimes ?? [];
  const currentIdx = validTimeMs != null ? Math.max(0, validTimes.indexOf(validTimeMs)) : 0;

  const noonMs = jstNoon(dateKey).getTime();
  const nightSteps = validTimes.filter((t) => t >= noonMs + 5 * HOUR_MS && t <= noonMs + 18 * HOUR_MS);

  // 現在選択されている雲層（全雲量・上層・中層・下層）の実際のカラースケールを取得
  const scale = getColorScale(cloudVar, true);
  const breakpoints = 'breakpoints' in scale ? scale.breakpoints : [];
  const activeLayerLabel = CLOUD_LAYERS.find((l) => l.id === cloudVar)?.label ?? '雲量';
  const legendTicks = breakpoints.length ? [...breakpoints, 100] : [];

  return (
    <section className="card">
      <div className="card-head">
        <div className="head-text">
          <CardTitle icon="cloud" tone="cloud">
            雲量マップ<span className="title-sub">空間分布</span>
          </CardTitle>
          <p className="card-desc">地図上の任意の地点をクリックすると、その地点の雲量（%）を表示します。モデル・雲の層・時刻を切り替えて確認できます。</p>
        </div>
        {displayMeta && (
          <span className="head-note mono">
            <span className="muted">初期時刻</span> {formatDateShort(toDateKey(new Date(displayMeta.referenceTime)))}{' '}
            {formatHM(new Date(displayMeta.referenceTime))} JST
          </span>
        )}
      </div>

      <div className="toolbar">
        <div className="toolbar-row">
          <label className="ctrl">
            <span className="ctrl-label">予報モデル</span>
            <select className="select" value={spatialDomain} onChange={(e) => setSpatialDomain(e.target.value as SpatialDomainId)}>
              {SPATIAL_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <div className="ctrl">
            <span className="ctrl-label">雲の層</span>
            <div className="seg-group" role="group" aria-label="雲の層">
              {CLOUD_LAYERS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={cloudVar === l.id ? 'seg active' : 'seg'}
                  onClick={() => setCloudVar(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <label className="ctrl">
            <span className="ctrl-label">不透明度</span>
            <input
              type="range"
              className="range opacity-range"
              min={0.2}
              max={0.95}
              step={0.05}
              value={cloudOpacity}
              onChange={(e) => setCloudOpacity(Number(e.target.value))}
            />
            <span className="mono ctrl-value">{Math.round(cloudOpacity * 100)}%</span>
          </label>
        </div>

        {spatialError && <div className="error">{spatialError}</div>}

        {validTimes.length > 0 && validTimeMs != null && (
          <div className="time-player">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setValidTimeMs(validTimes[Math.max(0, currentIdx - 1)])}
              disabled={currentIdx <= 0}
              aria-label="前の時刻"
            >
              <Icon name="chevronLeft" />
            </button>
            <div className="time-readout mono">
              <b>
                {formatDateShort(toDateKey(new Date(validTimeMs)))} {formatHM(new Date(validTimeMs))}
              </b>
              <span className="muted">（{formatTime(new Date(validTimeMs), dateKey)}）</span>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setValidTimeMs(validTimes[Math.min(validTimes.length - 1, currentIdx + 1)])}
              disabled={currentIdx >= validTimes.length - 1}
              aria-label="次の時刻"
            >
              <Icon name="chevronRight" />
            </button>
            <input
              type="range"
              className="range time-range"
              min={0}
              max={validTimes.length - 1}
              value={currentIdx}
              onChange={(e) => setValidTimeMs(validTimes[Number(e.target.value)])}
              aria-label="予報時刻"
            />
          </div>
        )}

        {nightSteps.length > 0 && (
          <div className="night-quick-steps">
            <span className="ctrl-label">選択夜の時刻ジャンプ</span>
            <div className="step-list">
              {nightSteps.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={t === validTimeMs ? 'step-btn active' : 'step-btn'}
                  onClick={() => setValidTimeMs(t)}
                >
                  {formatHM(new Date(t))}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 大きく表示する雲量マップ本体 */}
      <div className="map-frame">
        <div ref={containerRef} className="map-box" />
        <select className="select map-overlay-select" value={tileId} onChange={(e) => setTileId(e.target.value as TileLayerId)} aria-label="地図タイル切替">
          {TILE_IDS.map((k) => (
            <option key={k} value={k}>
              {TILE_CONFIG[k].label}
            </option>
          ))}
        </select>
      </div>

      {/* クリック地点の雲量表示バー */}
      {probe && (
        <div className="probe-bar">
          <div className="probe-main">
            <span className="probe-coord mono">
              <Icon name="target" size={15} />
              選択地点 ({formatLatLon(probe.lat, probe.lon)})
            </span>
            <span className="probe-highlight">
              {activeLayerLabel}{' '}
              <b className="mono">{probe.loading ? '読取中…' : probe.activeValue == null ? '—' : `${probe.activeValue}%`}</b>
            </span>
          </div>
          <div className="probe-layers">
            {CLOUD_LAYERS.map((l) => {
              const v = probe.allLayers[l.id];
              return (
                <span key={l.id} className={l.id === cloudVar ? 'probe-chip active' : 'probe-chip'}>
                  <span className="muted">{l.label}</span> <b className="mono">{v == null ? '—' : `${v}%`}</b>
                </span>
              );
            })}
            <button type="button" className="btn ghost sm" onClick={() => setProbe(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* カラー凡例（選択中の層の実際のパレット＋4層の色分けガイド） */}
      <div className="cloud-legend">
        <div className="legend-head">
          <span className="legend-title">{activeLayerLabel} カラー凡例 (%)</span>
          <span className="muted">※ 0%（快晴）は透明になり下の地図が見えます</span>
        </div>
        <div className="legend-bar">
          {breakpoints.map((bp: number, i: number) => {
            const [r, g, b, a] = scale.colors[i] ?? [0, 0, 0, 0];
            const nextBp = breakpoints[i + 1] ?? 100;
            return (
              <span
                key={bp}
                className="legend-seg"
                style={{ flexGrow: nextBp - bp, background: `rgba(${r}, ${g}, ${b}, ${a})` }}
                title={`${bp}–${nextBp}%`}
              />
            );
          })}
        </div>
        <div className="legend-ticks mono">
          {legendTicks.map((v, i) => (
            <span
              key={v}
              className={v % 20 === 0 ? undefined : 'minor'}
              style={{
                left: `${v}%`,
                transform: i === 0 ? 'none' : i === legendTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {v}
            </span>
          ))}
        </div>
        <div className="legend-layer-guide">
          <span className="ctrl-label">層別の色分け</span>
          <span>
            <i className="layer-swatch total" /> 全雲量（白〜灰白色）
          </span>
          <span>
            <i className="layer-swatch high" /> 上層雲 8km〜（青色）
          </span>
          <span>
            <i className="layer-swatch mid" /> 中層雲 3〜8km（緑色）
          </span>
          <span>
            <i className="layer-swatch low" /> 下層雲 〜3km（赤色）
          </span>
        </div>
      </div>
    </section>
  );
}
