// 登録地点・選択状態の保存（localStorage）とプリセット地点。
// プリセットには要件定義の北海道観測候補地＋astronomy-desktop-widget の主要都市を収録。

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface PresetGroup {
  region: string;
  places: Place[];
}

export const CURRENT_ID = 'current';
const PLACES_KEY = 'aw.places';
const SELECTED_KEY = 'aw.selected';

/** 現在地が取れないときの既定地点（札幌） */
export const FALLBACK_PLACE: Place = { id: CURRENT_ID, name: '札幌（既定）', lat: 43.0643, lon: 141.3469 };

/** 初回起動時に登録しておく北海道の天体観測候補地 */
export const INITIAL_PLACES: Place[] = [
  { id: 'preset-ashibetsu', name: '芦別（カナディアンワールド）', lat: 43.4792, lon: 142.1478 },
  { id: 'preset-tobetsu', name: '当別（県民の森付近）', lat: 43.3189, lon: 141.5586 },
  { id: 'preset-shikotsu', name: '支笏湖畔', lat: 42.7697, lon: 141.4044 },
  { id: 'preset-biei', name: '美瑛', lat: 43.5906, lon: 142.4689 },
  { id: 'preset-horokanai', name: '幌加内（朱鞠内湖）', lat: 44.2856, lon: 142.1636 },
  { id: 'preset-niseko', name: 'ニセコ', lat: 42.8048, lon: 140.6874 },
];

/** ワンクリックで追加できる地域別プリセット（astronomy-desktop-widget 準拠＋北海道観測地） */
export const PRESET_GROUPS: PresetGroup[] = [
  {
    region: '北海道（観測スポット）',
    places: INITIAL_PLACES,
  },
  {
    region: '北海道（主要都市）',
    places: [
      { id: 'hokkaido-sapporo', name: '札幌', lat: 43.0643, lon: 141.3469 },
      { id: 'hokkaido-hakodate', name: '函館', lat: 41.7687, lon: 140.7288 },
      { id: 'hokkaido-asahikawa', name: '旭川', lat: 43.7706, lon: 142.365 },
      { id: 'hokkaido-muroran', name: '室蘭', lat: 42.3152, lon: 140.9738 },
      { id: 'hokkaido-obihiro', name: '帯広', lat: 42.9234, lon: 143.1962 },
      { id: 'hokkaido-kushiro', name: '釧路', lat: 42.9849, lon: 144.382 },
      { id: 'hokkaido-kitami', name: '北見', lat: 43.803, lon: 143.8945 },
      { id: 'hokkaido-abashiri', name: '網走', lat: 44.0206, lon: 144.2733 },
      { id: 'hokkaido-wakkanai', name: '稚内', lat: 45.4157, lon: 141.6731 },
      { id: 'hokkaido-nemuro', name: '根室', lat: 43.3301, lon: 145.5828 },
    ],
  },
  {
    region: '東北・関東・中部（主要都市）',
    places: [
      { id: 'aomori', name: '青森', lat: 40.8246, lon: 140.7405 },
      { id: 'miyagi', name: '仙台', lat: 38.2686, lon: 140.8721 },
      { id: 'fukushima', name: '福島', lat: 37.75, lon: 140.4678 },
      { id: 'tochigi', name: '宇都宮', lat: 36.5659, lon: 139.8836 },
      { id: 'gunma', name: '前橋', lat: 36.3907, lon: 139.0605 },
      { id: 'tokyo', name: '東京（新宿）', lat: 35.6895, lon: 139.6917 },
      { id: 'niigata', name: '新潟', lat: 37.9025, lon: 139.0232 },
      { id: 'nagano', name: '長野', lat: 36.6513, lon: 138.1809 },
      { id: 'yamanashi', name: '甲府', lat: 35.6641, lon: 138.5685 },
      { id: 'shizuoka', name: '静岡', lat: 34.9769, lon: 138.3831 },
      { id: 'aichi', name: '名古屋', lat: 35.1802, lon: 136.9066 },
    ],
  },
  {
    region: '西日本（主要都市）',
    places: [
      { id: 'kyoto', name: '京都', lat: 35.0212, lon: 135.7556 },
      { id: 'osaka', name: '大阪', lat: 34.6863, lon: 135.52 },
      { id: 'hyogo', name: '神戸', lat: 34.6913, lon: 135.1831 },
      { id: 'tottori', name: '鳥取', lat: 35.5034, lon: 134.2383 },
      { id: 'okayama', name: '岡山', lat: 34.6617, lon: 133.935 },
      { id: 'hiroshima', name: '広島', lat: 34.3966, lon: 132.4596 },
      { id: 'kochi', name: '高知', lat: 33.5597, lon: 133.5311 },
      { id: 'fukuoka', name: '福岡', lat: 33.6064, lon: 130.418 },
      { id: 'kumamoto', name: '熊本', lat: 32.7898, lon: 130.7416 },
      { id: 'kagoshima', name: '鹿児島', lat: 31.5602, lon: 130.558 },
      { id: 'okinawa', name: '那覇', lat: 26.2124, lon: 127.6809 },
    ],
  },
];

export function loadPlaces(): Place[] {
  try {
    const raw = localStorage.getItem(PLACES_KEY);
    if (raw === null) {
      // 初回は北海道の天体観測候補地 6 か所を既定で登録する
      savePlaces(INITIAL_PLACES);
      return INITIAL_PLACES;
    }
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number') : [];
  } catch {
    return INITIAL_PLACES;
  }
}

export function savePlaces(places: Place[]) {
  localStorage.setItem(PLACES_KEY, JSON.stringify(places));
}

export function loadSelected(): string {
  return localStorage.getItem(SELECTED_KEY) ?? CURRENT_ID;
}

export function saveSelected(id: string) {
  localStorage.setItem(SELECTED_KEY, id);
}

export function newPlaceId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** "43.08°N, 141.35°E" */
export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}
