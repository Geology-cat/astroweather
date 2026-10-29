import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { omProtocol } from '@openmeteo/weather-map-layer';
import { nightWindow } from '../lib/astro';
import { COMPARE_VARS } from '../lib/forecast';
import { computeNightScore, scoreColor } from '../lib/score';
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
import type { Place } from '../lib/storage';
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

type TileLayerId = 'pale' | 'hillshade' | 'photo' | 'osm';

const TILE_CONFIG: Record<TileLayerId, { label: string; tiles: string[]; attribution: string; maxzoom: number }> = {
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
  osm: {
    label: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    maxzoom: 19,
  },
};

function makeStyle(layerId: TileLayerId): maplibregl.StyleSpecification {
  const cfg = TILE_CONFIG[layerId];
  return {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: cfg.tiles,
        tileSize: 256,
        attribution: cfg.attribution,
        maxzoom: cfg.maxzoom,
      },
    },
    layers: [
      {
        id: 'base-layer',
        type: 'raster',
        source: 'base',
      },
    ],
  };
}

const OM_SOURCE_ID = 'om-cloud-source';
const OM_LAYER_ID = 'om-cloud-layer';

/** SCW風の面的な雲量マップ専用パネル */
export function CloudMapPanel({ dateKey, places, currentPlace, selectedId, onSelectPlace }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [tileId, setTileId] = useState<TileLayerId>('pale');
  const [mapReady, setMapReady] = useState(false);

  const [spatialDomain, setSpatialDomain] = useState<SpatialDomainId>('jma_msm');
  const [cloudVar, setCloudVar] = useState<CloudLayerVar>('cloud_cover');
  const [cloudOpacity, setCloudOpacity] = useState(0.75);
  const [spatialMeta, setSpatialMeta] = useState<SpatialMeta | null>(null);
  const [spatialError, setSpatialError] = useState<string | null>(null);
  const [validTimeMs, setValidTimeMs] = useState<number | null>(null);

  const allPlaces = places.length > 0 ? places : [currentPlace];
  const { data: forecasts } = useForecasts(allPlaces, COMPARE_VARS);

  const defaultTargetMs = (key: DateKey) => jstNoon(key).getTime() + 9 * HOUR_MS; // 21:00 JST

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

  useEffect(() => {
    ensureOmProtocol();
    if (!containerRef.current) return;
    const selected = allPlaces.find((p) => p.id === selectedId) ?? currentPlace;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(tileId),
      center: [selected.lon, selected.lat],
      zoom: 6.0,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => setMapReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setMapReady(false);
    map.once('styledata', () => setMapReady(true));
    map.setStyle(makeStyle(tileId));
  }, [tileId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (map.getLayer(OM_LAYER_ID)) map.removeLayer(OM_LAYER_ID);
    if (map.getSource(OM_SOURCE_ID)) map.removeSource(OM_SOURCE_ID);

    if (!spatialMeta || validTimeMs == null) return;

    const omUrl = buildOmTileUrl(spatialDomain, spatialMeta, validTimeMs, cloudVar, true);
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
  }, [mapReady, spatialDomain, spatialMeta, validTimeMs, cloudVar, cloudOpacity]);

  useEffect(() => {
    if (!mapRef.current) return;
    const selected = [currentPlace, ...places].find((p) => p.id === selectedId);
    if (selected) {
      mapRef.current.flyTo({ center: [selected.lon, selected.lat], duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // 登録地点のマーカー（位置確認と地点切替のみ）
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    allPlaces.forEach((p, idx) => {
      const win = nightWindow(p, dateKey);
      const fc = forecasts?.[idx];
      const ns = fc && win ? computeNightScore(fc, win) : null;
      const sc = ns?.score ?? null;

      const el = document.createElement('button');
      el.type = 'button';
      el.className = p.id === selectedId ? 'map-marker active' : 'map-marker';
      el.style.borderColor = scoreColor(sc);
      el.innerHTML = `<span class="mm-score" style="background:${scoreColor(sc)}">${sc ?? '—'}</span><span class="mm-name">${p.name}</span>`;
      el.onclick = (ev) => {
        ev.stopPropagation();
        onSelectPlace(p.id);
      };

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map);
      markersRef.current.push(marker);
    });
  }, [allPlaces, forecasts, dateKey, selectedId, onSelectPlace]);

  const validTimes = spatialMeta?.validTimes ?? [];
  const currentIdx = validTimeMs != null ? Math.max(0, validTimes.indexOf(validTimeMs)) : 0;

  const noonMs = jstNoon(dateKey).getTime();
  const nightSteps = validTimes.filter((t) => t >= noonMs + 5 * HOUR_MS && t <= noonMs + 18 * HOUR_MS);

  return (
    <section className="card">
      <div className="panel-head">
        <div>
          <h2 className="card-title map">☁ 雲量マップ（空間分布）</h2>
          <p className="sub">
            Open-Meteo Spatial Data（S3 `.om` 格子データ）による面的な雲量分布。モデル・雲の層・時刻を切り替えて雲の動きを確認できます。
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

      <div ref={containerRef} className="map-box" />
    </section>
  );
}
