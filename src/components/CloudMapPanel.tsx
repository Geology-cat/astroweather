import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getColorScale, getValueFromLatLong, omProtocol } from '@openmeteo/weather-map-layer';
import type { ModelId } from '../lib/forecast';
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
import { useForecasts } from '../lib/useForecasts';

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

type TileLayerId = 'osm' | 'pale' | 'hillshade' | 'photo';

const TILE_CONFIG: Record<TileLayerId, { label: string; tiles: string[]; attribution: string; maxzoom: number }> = {
  osm: {
    label: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    maxzoom: 19,
  },
  pale: {
    label: '地理院 淡色地図',
    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル（淡色地図）</a>',
    maxzoom: 18,
  },
  hillshade: {
    label: '地理院 陰影起伏図',
    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png'],
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル（陰影起伏図）</a>',
    maxzoom: 16,
  },
  photo: {
    label: '地理院 航空写真',
    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'],
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル（写真）</a>',
    maxzoom: 18,
  },
};

const OM_SOURCE_ID = 'om-cloud-source';
const OM_LAYER_ID = 'om-cloud-layer';

/**
 * ベース地図タイルと雲量オーバーレイの両方を 1 つのスタイル定義にまとめる。
 * こうすることで、ベース地図を切り替えたときにも雲量レイヤーが途切れず一緒に再描画される。
 */
function buildCloudMapStyle(
  layerId: TileLayerId,
  omUrl: string | null,
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
  if (omUrl) {
    sources[OM_SOURCE_ID] = {
      type: 'raster',
      url: omUrl,
      maxzoom: 12,
    };
    layers.push({
      id: OM_LAYER_ID,
      type: 'raster',
      source: OM_SOURCE_ID,
      paint: {
        'raster-opacity': opacity,
        'raster-fade-duration': 150,
      },
    });
  }
  return { version: 8, sources, layers };
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
  const prevTileIdRef = useRef<TileLayerId>('osm');

  const [tileId, setTileId] = useState<TileLayerId>('osm');
  const [mapReady, setMapReady] = useState(false);

  const [spatialDomain, setSpatialDomain] = useState<SpatialDomainId>('jma_msm');
  const [cloudVar, setCloudVar] = useState<CloudLayerVar>('cloud_cover');
  const [cloudOpacity, setCloudOpacity] = useState(0.78);
  const [spatialMeta, setSpatialMeta] = useState<SpatialMeta | null>(null);
  const [spatialError, setSpatialError] = useState<string | null>(null);
  const [validTimeMs, setValidTimeMs] = useState<number | null>(null);

  // クリックした地点の雲量読み取り状態
  const [probe, setProbe] = useState<ProbePoint | null>(null);

  const allPlaces = places.length > 0 ? places : [currentPlace];
  // 登録地点マーカーに全4層（全雲量・上層・中層・下層）の指定時刻の雲量%を表示するために4層を取得
  const CLOUD_MARKER_VARS = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'] as const;
  const { data: forecasts } = useForecasts(allPlaces, CLOUD_MARKER_VARS);

  const defaultTargetMs = (key: DateKey) => jstNoon(key).getTime() + 9 * HOUR_MS; // 21:00 JST

  const omUrl =
    spatialMeta && validTimeMs != null
      ? buildOmTileUrl(spatialDomain, spatialMeta, validTimeMs, cloudVar, true)
      : null;

  const omUrlRef = useRef<string | null>(null);
  omUrlRef.current = omUrl;
  const cloudVarRef = useRef<CloudLayerVar>(cloudVar);
  cloudVarRef.current = cloudVar;
  const validTimeRef = useRef<number | null>(validTimeMs);
  validTimeRef.current = validTimeMs;
  const domainRef = useRef<SpatialDomainId>(spatialDomain);
  domainRef.current = spatialDomain;
  const metaRef = useRef<SpatialMeta | null>(spatialMeta);
  metaRef.current = spatialMeta;

  useEffect(() => {
    let alive = true;
    setSpatialError(null);
    fetchSpatialMeta(spatialDomain)
      .then((meta) => {
        if (!alive) return;
        setSpatialMeta(meta);
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
      style: buildCloudMapStyle(tileId, omUrl, cloudOpacity),
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
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ベース地図・雲量ソース・時刻・層が変わったときの反映（ベース切替時も雲量レイヤーを同時に組み込むため途切れない）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (prevTileIdRef.current !== tileId) {
      prevTileIdRef.current = tileId;
      map.setStyle(buildCloudMapStyle(tileId, omUrl, cloudOpacity));
      return;
    }

    if (map.getLayer(OM_LAYER_ID)) map.removeLayer(OM_LAYER_ID);
    if (map.getSource(OM_SOURCE_ID)) map.removeSource(OM_SOURCE_ID);

    if (!omUrl) return;

    map.addSource(OM_SOURCE_ID, {
      type: 'raster',
      url: omUrl,
      maxzoom: 12,
    });
    map.addLayer({
      id: OM_LAYER_ID,
      type: 'raster',
      source: OM_SOURCE_ID,
      paint: {
        'raster-opacity': cloudOpacity,
        'raster-fade-duration': 150,
      },
    });
  }, [mapReady, tileId, omUrl]);

  // 不透明度の変更はレイヤーを作り直さずに paint プロパティだけ即時反映
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getLayer(OM_LAYER_ID)) {
      map.setPaintProperty(OM_LAYER_ID, 'raster-opacity', cloudOpacity);
    }
  }, [mapReady, cloudOpacity]);

  // 層や時刻が変わったときに、選択中のプローブ地点があれば値も更新
  useEffect(() => {
    if (probe && validTimeMs != null) {
      probeAt(probe.lat, probe.lon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudVar, validTimeMs, spatialDomain]);

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
    el.innerHTML = `<span class="probe-val">${layerLabel}: <b>${valText}</b></span><span class="probe-dot"></span>`;

    probeMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
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

      const el = document.createElement('button');
      el.type = 'button';
      el.className = p.id === selectedId ? 'map-pin active' : 'map-pin';
      el.style.setProperty('--pin-color', badgeColor);
      el.innerHTML = `<span class="pin-bubble"><span class="pin-badge">${cloudPct == null ? '—' : `${cloudPct}%`}</span><span class="pin-label">${p.name}</span></span><span class="pin-stem"></span><span class="pin-tip"></span>`;
      el.onclick = (ev) => {
        ev.stopPropagation();
        onSelectPlace(p.id);
      };

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map);
      markersRef.current.push(marker);
    });
  }, [allPlaces, forecasts, spatialDomain, cloudVar, validTimeMs, selectedId, onSelectPlace]);

  const validTimes = spatialMeta?.validTimes ?? [];
  const currentIdx = validTimeMs != null ? Math.max(0, validTimes.indexOf(validTimeMs)) : 0;

  const noonMs = jstNoon(dateKey).getTime();
  const nightSteps = validTimes.filter((t) => t >= noonMs + 5 * HOUR_MS && t <= noonMs + 18 * HOUR_MS);

  // 現在選択されている雲層（全雲量・上層・中層・下層）の実際のカラースケールを取得
  const scale = getColorScale(cloudVar, true);
  const breakpoints = 'breakpoints' in scale ? scale.breakpoints : [];
  const activeLayerLabel = CLOUD_LAYERS.find((l) => l.id === cloudVar)?.label ?? '雲量';

  return (
    <section className="card">
      <div className="panel-head">
        <div>
          <h2 className="card-title map">☁ 雲量マップ（空間分布）</h2>
          <p className="sub">
            地図上の任意の地点をクリックすると、その地点の雲量（%）を表示します。モデル・雲の層・時刻を切り替えて確認できます。
          </p>
        </div>
        <div className="panel-controls">
          <select className="ctrl-select" value={tileId} onChange={(e) => setTileId(e.target.value as TileLayerId)} aria-label="地図タイル切替">
            {(Object.keys(TILE_CONFIG) as TileLayerId[]).map((k) => (
              <option key={k} value={k}>
                {TILE_CONFIG[k].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="cloud-ctrl-box">
        <div className="cloud-ctrl-top">
          <div className="cloud-ctrl-group">
            <span className="sub">予報モデル:</span>
            <select
              className="ctrl-select"
              value={spatialDomain}
              onChange={(e) => setSpatialDomain(e.target.value as SpatialDomainId)}
            >
              {SPATIAL_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="cloud-ctrl-group">
            <span className="sub">雲の層:</span>
            <div className="seg-group">
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

          <div className="cloud-ctrl-group">
            <span className="sub">不透明度:</span>
            <input
              type="range"
              min={0.2}
              max={0.95}
              step={0.05}
              value={cloudOpacity}
              onChange={(e) => setCloudOpacity(Number(e.target.value))}
              style={{ width: 80 }}
            />
          </div>

          {spatialMeta && (
            <span className="sub mono">
              初期時刻: {formatDateShort(toDateKey(new Date(spatialMeta.referenceTime)))}{' '}
              {formatHM(new Date(spatialMeta.referenceTime))} JST
            </span>
          )}
        </div>

        {spatialError && <div className="error">{spatialError}</div>}

        {validTimes.length > 0 && validTimeMs != null && (
          <div className="cloud-slider-row">
            <button
              type="button"
              className="round-btn"
              onClick={() => setValidTimeMs(validTimes[Math.max(0, currentIdx - 1)])}
              disabled={currentIdx <= 0}
              aria-label="前の時刻"
            >
              ‹
            </button>
            <div className="cloud-time-readout mono">
              <b>
                {formatDateShort(toDateKey(new Date(validTimeMs)))} {formatHM(new Date(validTimeMs))}
              </b>{' '}
              <span className="sub">({formatTime(new Date(validTimeMs), dateKey)})</span>
            </div>
            <button
              type="button"
              className="round-btn"
              onClick={() => setValidTimeMs(validTimes[Math.min(validTimes.length - 1, currentIdx + 1)])}
              disabled={currentIdx >= validTimes.length - 1}
              aria-label="次の時刻"
            >
              ›
            </button>
            <input
              type="range"
              className="cloud-slider"
              min={0}
              max={validTimes.length - 1}
              value={currentIdx}
              onChange={(e) => setValidTimeMs(validTimes[Number(e.target.value)])}
            />
          </div>
        )}

        {nightSteps.length > 0 && (
          <div className="night-quick-steps">
            <span className="sub">選択夜の時刻ジャンプ:</span>
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
        )}
      </div>

      {/* 大きく表示する雲量マップ本体 */}
      <div ref={containerRef} className="map-box cloud-map-large" />

      {/* クリック地点の雲量表示バー */}
      {probe && (
        <div className="cloud-probe-bar">
          <div className="probe-main">
            <span className="mono">🎯 選択地点 ({formatLatLon(probe.lat, probe.lon)})</span>
            <span className="probe-highlight">
              {activeLayerLabel}:{' '}
              <b>{probe.loading ? '読取中…' : probe.activeValue == null ? '—' : `${probe.activeValue}%`}</b>
            </span>
          </div>
          <div className="probe-layers">
            {CLOUD_LAYERS.map((l) => {
              const v = probe.allLayers[l.id];
              return (
                <span key={l.id} className={l.id === cloudVar ? 'probe-chip active' : 'probe-chip'}>
                  <span className="sub">{l.label}:</span> <b>{v == null ? '—' : `${v}%`}</b>
                </span>
              );
            })}
            <button type="button" className="btn" onClick={() => setProbe(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* カラー凡例（選択中の層の実際のパレット＋4層の色分けガイド） */}
      <div className="cloud-legend-box">
        <div className="legend-row">
          <span className="legend-title">{activeLayerLabel} カラー凡例 (%):</span>
          <div className="legend-scale">
            {breakpoints.map((bp: number, i: number) => {
              const [r, g, b, a] = scale.colors[i] ?? [0, 0, 0, 0];
              const nextBp = breakpoints[i + 1];
              const label = nextBp != null ? `${bp}–${nextBp}%` : `${bp}–100%`;
              return (
                <div key={bp} className="legend-step">
                  <span
                    className="legend-swatch"
                    style={{
                      background: `rgba(${r}, ${g}, ${b}, ${Math.max(0.18, a)})`,
                    }}
                  />
                  <span className="legend-num mono">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="legend-layer-guide sub">
          <span>層別の色分け:</span>
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
          <span>※ 0%（快晴）は透明になり下の地図が見えます</span>
        </div>
      </div>
    </section>
  );
}
