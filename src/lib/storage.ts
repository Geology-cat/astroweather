// 登録地点・選択状態の保存（localStorage）。
// プリセットは持たず、ユーザーが自分で登録した地点のみを保存・表示する。

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export const CURRENT_ID = 'current';
const PLACES_KEY = 'aw.places';
const SELECTED_KEY = 'aw.selected';

/** 地点名の最大文字数（KML 読み込みや保存データの改ざんで極端に長い名前が入らないように） */
export const MAX_PLACE_NAME_LENGTH = 100;

/** 地点として扱える値か（保存データは利用者の手元で書き換えられるので、読み込み時に必ず検証する） */
export function isValidPlace(p: unknown): p is Place {
  if (!p || typeof p !== 'object') return false;
  const v = p as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.startsWith('p') &&
    v.id.length <= 64 &&
    typeof v.name === 'string' &&
    typeof v.lat === 'number' &&
    typeof v.lon === 'number' &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lon) &&
    Math.abs(v.lat) <= 90 &&
    Math.abs(v.lon) <= 180
  );
}

/** 現在地が取得できないときのフォールバック座標 */
export const FALLBACK_PLACE: Place = { id: CURRENT_ID, name: '現在地（未取得）', lat: 43.0643, lon: 141.3469 };

export function loadPlaces(): Place[] {
  try {
    const raw = localStorage.getItem(PLACES_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    // ユーザー自身が登録した地点（id が "p" で始まるもの）のうち、値が正しいものだけを残す（旧プリセットも除外される）
    const userPlaces = v
      .filter(isValidPlace)
      .map((p) => ({ id: p.id, name: p.name.slice(0, MAX_PLACE_NAME_LENGTH), lat: p.lat, lon: p.lon }));
    if (userPlaces.length !== v.length) {
      savePlaces(userPlaces);
    }
    return userPlaces;
  } catch {
    return [];
  }
}

// localStorage はプライベートブラウズや容量超過で例外を投げることがあるため、
// 失敗しても画面が止まらないよう、読み書きはすべて例外を握りつぶす（保存されないだけ）
export function savePlaces(places: Place[]) {
  try {
    localStorage.setItem(PLACES_KEY, JSON.stringify(places));
  } catch {
    /* noop */
  }
}

export function loadSelected(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? CURRENT_ID;
  } catch {
    return CURRENT_ID;
  }
}

export function saveSelected(id: string) {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch {
    /* noop */
  }
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
