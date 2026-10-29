import { useEffect, useMemo, useRef, useState } from 'react';
import { nightWindow } from '../lib/astro';
import { COMPARE_VARS } from '../lib/forecast';
import { parseLatLonInput, searchPlaceCandidates, type GeocodeCandidate } from '../lib/geocode';
import { PIN_OFFSET, TILE_CONFIG, TILE_IDS, baseStyle, createPinMarker, maplibregl, type TileLayerId } from '../lib/maplibre';
import { computeNightScore, scoreColor } from '../lib/score';
import { formatLatLon, newPlaceId, type Place } from '../lib/storage';
import type { DateKey } from '../lib/time';
import { useForecasts } from '../lib/useForecasts';
import { CardTitle, Icon } from './Icon';

interface Props {
  dateKey: DateKey;
  places: Place[];
  currentPlace: Place;
  selectedId: string;
  onSelectPlace: (id: string) => void;
  onAddPlace: (place: Place) => void;
  onRemovePlace: (id: string) => void;
}

/** 観測地点の登録・管理専用マップパネル */
export function MapPanel({ dateKey, places, currentPlace, selectedId, onSelectPlace, onAddPlace, onRemovePlace }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [tileId, setTileId] = useState<TileLayerId>('osm');
  const [clickedLatLon, setClickedLatLon] = useState<{ lat: number; lon: number } | null>(null);
  const [newName, setNewName] = useState('');

  // 住所・地名検索用の状態
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // 緯度経度直接入力用の状態
  const [manualName, setManualName] = useState('');
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [coordError, setCoordError] = useState<string | null>(null);

  const allPlaces = useMemo(() => (places.length > 0 ? places : [currentPlace]), [places, currentPlace]);
  const { data: forecasts } = useForecasts(allPlaces, COMPARE_VARS);

  useEffect(() => {
    if (!containerRef.current) return;
    const selected = allPlaces.find((p) => p.id === selectedId) ?? currentPlace;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle(tileId),
      center: [selected.lon, selected.lat],
      zoom: 6.5,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      const lat = Number(e.lngLat.lat.toFixed(4));
      const lon = Number(e.lngLat.lng.toFixed(4));
      setClickedLatLon({ lat, lon });
      setLatInput(String(lat));
      setLonInput(String(lon));
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ベース地図の切替（初回は生成時のスタイルをそのまま使う）
  const appliedTileRef = useRef<TileLayerId>(tileId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedTileRef.current === tileId) return;
    appliedTileRef.current = tileId;
    map.setStyle(baseStyle(tileId));
  }, [tileId]);

  useEffect(() => {
    if (!mapRef.current) return;
    const selected = [currentPlace, ...places].find((p) => p.id === selectedId);
    if (selected) {
      mapRef.current.flyTo({ center: [selected.lon, selected.lat], duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
      const col = scoreColor(sc);

      const el = createPinMarker({
        label: p.name,
        badge: sc == null ? '—' : String(sc),
        color: col,
        active: p.id === selectedId,
        onClick: () => onSelectPlace(p.id),
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: PIN_OFFSET }).setLngLat([p.lon, p.lat]).addTo(map);
      markersRef.current.push(marker);
    });
  }, [allPlaces, forecasts, dateKey, selectedId, onSelectPlace]);

  const registerPlace = (name: string, lat: number, lon: number) => {
    const finalName = name.trim() || `地点 (${lat.toFixed(2)}, ${lon.toFixed(2)})`;
    const created: Place = { id: newPlaceId(), name: finalName, lat, lon };
    onAddPlace(created);
    onSelectPlace(created.id);
    mapRef.current?.flyTo({ center: [lon, lat], zoom: Math.max(mapRef.current.getZoom(), 9), duration: 650 });
  };

  const handleAddClicked = () => {
    if (!clickedLatLon) return;
    registerPlace(newName, clickedLatLon.lat, clickedLatLon.lon);
    setNewName('');
    setClickedLatLon(null);
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    const list = await searchPlaceCandidates(q);
    setSearching(false);
    setCandidates(list);
    if (!list.length) {
      setSearchError('該当する住所・地名が見つかりませんでした。');
    } else if (mapRef.current) {
      mapRef.current.flyTo({ center: [list[0].lon, list[0].lat], zoom: 10, duration: 600 });
    }
  };

  const handleAddManualCoord = () => {
    setCoordError(null);
    const parsed = parseLatLonInput(latInput, lonInput);
    if (!parsed) {
      setCoordError('緯度（-90〜90）と経度（-180〜180）を正しく入力してください（例: 43.4792, 142.1478）');
      return;
    }
    registerPlace(manualName, parsed.lat, parsed.lon);
    setManualName('');
    setLatInput('');
    setLonInput('');
    setClickedLatLon(null);
  };

  const handleLatChange = (val: string) => {
    if (val.includes(',') || val.includes('，')) {
      const parts = val.split(/[,，]/).map((s) => s.trim());
      if (parts.length >= 2) {
        setLatInput(parts[0]);
        setLonInput(parts[1]);
        return;
      }
    }
    setLatInput(val);
  };

  return (
    <section className="card">
      <div className="card-head">
        <div className="head-text">
          <CardTitle icon="pin" tone="map">
            観測地点Map
          </CardTitle>
          <p className="card-desc">① 住所・地名検索、② 緯度・経度の直接入力、③ 地図クリック の3通りで観測地点を登録・削除できます。</p>
        </div>
      </div>

      {/* 地点登録フォーム（住所・地名検索 ＆ 緯度経度直接入力） */}
      <div className="place-add-grid">
        <div className="field-box">
          <div className="field-title">
            <Icon name="search" size={15} />
            住所・地名・施設名から検索して登録
          </div>
          <div className="input-row">
            <input
              type="text"
              className="input grow"
              placeholder="例：北海道芦別市 / 支笏湖 / 美瑛町白金 / 大雪山旭岳…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              aria-label="住所・地名・施設名"
            />
            <button type="button" className="btn primary" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
              {searching ? '検索中…' : '検索'}
            </button>
            {candidates.length > 0 && (
              <button type="button" className="btn ghost" onClick={() => setCandidates([])}>
                クリア
              </button>
            )}
          </div>
          {searchError && <div className="field-error">{searchError}</div>}
          {candidates.length > 0 && (
            <ul className="candidate-list">
              {candidates.map((c, idx) => (
                <li key={`${c.lat}-${c.lon}-${idx}`} className="candidate-item">
                  <button
                    type="button"
                    className="cand-info"
                    onClick={() => mapRef.current?.flyTo({ center: [c.lon, c.lat], zoom: 11, duration: 500 })}
                    title="地図でこの場所を表示"
                  >
                    <span className="cand-name">{c.name}</span>
                    <span className="muted">
                      {c.detail} — <span className="mono">{formatLatLon(c.lat, c.lon)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn primary sm"
                    onClick={() => {
                      registerPlace(c.name, c.lat, c.lon);
                      setCandidates([]);
                      setSearchQuery('');
                    }}
                  >
                    <Icon name="plus" size={14} />
                    登録
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="field-box">
          <div className="field-title">
            <Icon name="compass" size={15} />
            緯度・経度を入力して登録<span className="muted">（カンマ区切りペースト可）</span>
          </div>
          <div className="input-row">
            <input
              type="text"
              className="input name-input"
              placeholder="地点名（任意）"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddManualCoord()}
              aria-label="地点名"
            />
            <input
              type="text"
              inputMode="decimal"
              className="input coord-input mono"
              placeholder="緯度 (例: 43.4792)"
              value={latInput}
              onChange={(e) => handleLatChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddManualCoord()}
              aria-label="緯度"
            />
            <input
              type="text"
              inputMode="decimal"
              className="input coord-input mono"
              placeholder="経度 (例: 142.1478)"
              value={lonInput}
              onChange={(e) => setLonInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddManualCoord()}
              aria-label="経度"
            />
            <button type="button" className="btn primary" onClick={handleAddManualCoord} disabled={!latInput.trim()}>
              <Icon name="plus" size={14} />
              登録
            </button>
          </div>
          {coordError && <div className="field-error">{coordError}</div>}
        </div>
      </div>

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

      {clickedLatLon && (
        <div className="map-add-bar">
          <span className="add-bar-coord mono">
            <Icon name="target" size={15} />
            地図クリック座標: {formatLatLon(clickedLatLon.lat, clickedLatLon.lon)}
          </span>
          <div className="input-row">
            <input
              type="text"
              className="input grow"
              placeholder="観測地点の名前を入力…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddClicked()}
              aria-label="観測地点の名前"
            />
            <button type="button" className="btn primary" onClick={handleAddClicked}>
              この地点を登録
            </button>
            <button type="button" className="btn ghost" onClick={() => setClickedLatLon(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      <div className="place-manager">
        <span className="manager-label">登録地点 <span className="count-badge mono">{places.length}</span></span>
        {places.length === 0 ? (
          <div className="muted">登録された観測地点はありません。上の検索・緯度経度入力・地図クリックから登録してください。</div>
        ) : (
          <div className="place-chips">
            {places.map((p) => (
              <span key={p.id} className={p.id === selectedId ? 'place-chip active' : 'place-chip'}>
                <button type="button" className="chip-select" onClick={() => onSelectPlace(p.id)}>
                  {p.name} <span className="muted mono">{formatLatLon(p.lat, p.lon)}</span>
                </button>
                <button type="button" className="chip-del" onClick={() => onRemovePlace(p.id)} title="削除" aria-label={`${p.name}を削除`}>
                  <Icon name="close" size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
