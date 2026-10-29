import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { nightWindow } from '../lib/astro';
import { COMPARE_VARS } from '../lib/forecast';
import { computeNightScore, scoreColor } from '../lib/score';
import { formatLatLon, newPlaceId, type Place } from '../lib/storage';
import type { DateKey } from '../lib/time';
import { useForecasts } from '../lib/useForecasts';

interface Props {
  dateKey: DateKey;
  places: Place[];
  currentPlace: Place;
  selectedId: string;
  onSelectPlace: (id: string) => void;
  onAddPlace: (place: Place) => void;
  onRemovePlace: (id: string) => void;
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

export function MapPanel({ dateKey, places, currentPlace, selectedId, onSelectPlace, onAddPlace, onRemovePlace }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [tileId, setTileId] = useState<TileLayerId>('pale');
  const [clickedLatLon, setClickedLatLon] = useState<{ lat: number; lon: number } | null>(null);
  const [newName, setNewName] = useState('');

  // 地図上のマーカーはユーザーが登録した地点のみ（未登録時は選択中の現在地のみ）
  const allPlaces = places.length > 0 ? places : [currentPlace];
  const { data: forecasts } = useForecasts(allPlaces, COMPARE_VARS);

  // 地図初期化
  useEffect(() => {
    if (!containerRef.current) return;
    const selected = allPlaces.find((p) => p.id === selectedId) ?? currentPlace;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(tileId),
      center: [selected.lon, selected.lat],
      zoom: 6.5,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      setClickedLatLon({ lat: Number(e.lngLat.lat.toFixed(4)), lon: Number(e.lngLat.lng.toFixed(4)) });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // タイル切替
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setStyle(makeStyle(tileId));
  }, [tileId]);

  // 選択地点が変わったらパン
  useEffect(() => {
    if (!mapRef.current) return;
    const selected = [currentPlace, ...places].find((p) => p.id === selectedId);
    if (selected) {
      mapRef.current.flyTo({ center: [selected.lon, selected.lat], duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // マーカー描画（各地点の夜間晴天スコアバッジ付き）
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

  const handleAddClicked = () => {
    if (!clickedLatLon) return;
    const name = newName.trim() || `地点 (${clickedLatLon.lat.toFixed(2)}, ${clickedLatLon.lon.toFixed(2)})`;
    const created: Place = { id: newPlaceId(), name, lat: clickedLatLon.lat, lon: clickedLatLon.lon };
    onAddPlace(created);
    onSelectPlace(created.id);
    setNewName('');
    setClickedLatLon(null);
  };

  return (
    <section className="card">
      <div className="panel-head">
        <div>
          <h2 className="card-title map">🗺 観測地点マップ & 地点登録</h2>
          <p className="sub">地図上をクリックして名前を付けると観測地点として登録されます。マーカーの数字はその夜の夜間晴天スコアです。</p>
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

      <div ref={containerRef} className="map-box" />

      {clickedLatLon && (
        <div className="map-add-bar">
          <span className="mono">📍 選択座標: {formatLatLon(clickedLatLon.lat, clickedLatLon.lon)}</span>
          <input
            type="text"
            className="text-input"
            placeholder="観測地点の名前を入力…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddClicked()}
          />
          <button className="btn primary" onClick={handleAddClicked}>
            この地点を登録
          </button>
          <button className="btn" onClick={() => setClickedLatLon(null)}>
            閉じる
          </button>
        </div>
      )}

      <div className="place-manager">
        {places.length === 0 ? (
          <div className="sub">登録された観測地点はありません。上の地図をクリックして登録してください。</div>
        ) : (
          <div className="place-chips">
            {places.map((p) => (
              <span key={p.id} className={p.id === selectedId ? 'place-chip active' : 'place-chip'}>
                <button className="chip-select" onClick={() => onSelectPlace(p.id)}>
                  {p.name}
                </button>
                <button className="chip-del" onClick={() => onRemovePlace(p.id)} title="削除" aria-label={`${p.name}を削除`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
