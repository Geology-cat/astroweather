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

/** 現在地が取得できないときのフォールバック座標 */
export const FALLBACK_PLACE: Place = { id: CURRENT_ID, name: '現在地（未取得）', lat: 43.0643, lon: 141.3469 };

export function loadPlaces(): Place[] {
  try {
    const raw = localStorage.getItem(PLACES_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    // ユーザー自身が登録した地点（id が "p" で始まるもの）のみを残し、旧プリセットは除外する
    const userPlaces = v.filter(
      (p): p is Place =>
        p &&
        typeof p.id === 'string' &&
        p.id.startsWith('p') &&
        typeof p.name === 'string' &&
        typeof p.lat === 'number' &&
        typeof p.lon === 'number',
    );
    if (userPlaces.length !== v.length) {
      savePlaces(userPlaces);
    }
    return userPlaces;
  } catch {
    return [];
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
