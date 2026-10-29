// MapLibre の共通設定（ワーカー URL・ベース地図タイル定義）。
// 2 つの地図パネルで同じ設定を使うため、ここに集約する。
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// バンドル後は MapLibre が自身の位置からワーカーを解決できないため、Vite が出力した URL を明示する
maplibregl.setWorkerUrl(workerUrl);

export { maplibregl };

export type TileLayerId = 'osm' | 'pale' | 'hillshade' | 'photo';

export const TILE_CONFIG: Record<TileLayerId, { label: string; tiles: string[]; attribution: string; maxzoom: number }> = {
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

export const TILE_IDS = Object.keys(TILE_CONFIG) as TileLayerId[];

/** ベース地図だけのスタイル定義 */
export function baseStyle(layerId: TileLayerId): maplibregl.StyleSpecification {
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
    layers: [{ id: 'base-layer', type: 'raster', source: 'base' }],
  };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * 地点ピンのマーカー要素。
 * 外側の要素は MapLibre が transform で位置を制御するので、アニメーションは内側のボタンにだけ付ける
 * （外側に transition を付けると、地図を素早く動かしたときにピンが遅れて追従しズレて見える）。
 */
export function createPinMarker(opts: {
  label: string;
  badge: string;
  color: string;
  active: boolean;
  onClick: () => void;
}): HTMLElement {
  const root = document.createElement('div');
  root.className = opts.active ? 'pin-marker is-active' : 'pin-marker';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'map-pin';
  btn.style.setProperty('--pin-color', opts.color);
  btn.setAttribute('aria-label', `${opts.label}（${opts.badge}）`);
  btn.innerHTML = `<span class="pin-bubble"><span class="pin-badge">${escapeHtml(opts.badge)}</span><span class="pin-label">${escapeHtml(
    opts.label,
  )}</span></span><span class="pin-stem"></span><span class="pin-tip"></span>`;
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    opts.onClick();
  });
  root.appendChild(btn);
  return root;
}

/** ピン先端の点の中心が座標に一致するよう、下端アンカーから戻すオフセット（px） */
export const PIN_OFFSET: [number, number] = [0, 4];
