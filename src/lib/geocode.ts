// 住所・地名・施設名からのジオコーディング検索と、緯度経度文字列のパース。
// 国土地理院の地名検索 API（msearch.gsi.go.jp）と OpenStreetMap Nominatim を併用する。

export interface GeocodeCandidate {
  name: string;
  detail: string;
  lat: number;
  lon: number;
  source: 'GSI' | 'OSM';
}

interface GsiFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { title?: string };
}

interface NominatimItem {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
}

/** 住所・地名・施設名で候補を検索する */
export async function searchPlaceCandidates(query: string): Promise<GeocodeCandidate[]> {
  const q = query.trim();
  if (!q) return [];

  const gsiPromise: Promise<GeocodeCandidate[]> = fetch(
    `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`,
  )
    .then(async (r) => (r.ok ? ((await r.json()) as GsiFeature[]) : []))
    .then((items) =>
      items
        .filter((f) => Array.isArray(f.geometry?.coordinates) && f.geometry!.coordinates!.length >= 2)
        .slice(0, 8)
        .map((f) => {
          const [lon, lat] = f.geometry!.coordinates!;
          const title = f.properties?.title ?? q;
          return {
            name: title,
            detail: `国土地理院 (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
            lat: Number(lat.toFixed(4)),
            lon: Number(lon.toFixed(4)),
            source: 'GSI' as const,
          };
        }),
    )
    .catch(() => []);

  const osmPromise: Promise<GeocodeCandidate[]> = fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&accept-language=ja&countrycodes=jp&limit=6`,
  )
    .then(async (r) => (r.ok ? ((await r.json()) as NominatimItem[]) : []))
    .then((items) =>
      items
        .filter((it) => it.lat != null && it.lon != null)
        .map((it) => {
          const lat = Number(Number(it.lat).toFixed(4));
          const lon = Number(Number(it.lon).toFixed(4));
          const short = it.name || it.display_name?.split(',')[0]?.trim() || q;
          return {
            name: short,
            detail: it.display_name ?? `${lat}, ${lon}`,
            lat,
            lon,
            source: 'OSM' as const,
          };
        }),
    )
    .catch(() => []);

  const [gsi, osm] = await Promise.all([gsiPromise, osmPromise]);

  // 近接重複（約100m以内）を除いて統合（OSMの施設名＋GSIの住所を両立）
  const merged: GeocodeCandidate[] = [];
  for (const c of [...osm, ...gsi]) {
    const dup = merged.some((m) => Math.abs(m.lat - c.lat) < 0.001 && Math.abs(m.lon - c.lon) < 0.001 && m.name === c.name);
    if (!dup) merged.push(c);
  }
  return merged.slice(0, 12);
}

/**
 * 緯度・経度の入力を検証して数値にする。
 * Google マップ等の「43.4792, 142.1478」や「43.4792°N, 142.1478°E」のような 1 文字列貼り付けにも対応。
 */
export function parseLatLonInput(latText: string, lonText: string): { lat: number; lon: number } | null {
  const combined = `${latText.trim()} ${lonText.trim()}`.trim();
  // 1つの欄に「43.4792, 142.1478」と貼り付けられた場合も分解する
  const clean = (s: string) => {
    const upper = s.toUpperCase();
    const sign = upper.includes('S') || upper.includes('W') ? -1 : 1;
    const num = Number(upper.replace(/[°NSWE\s]/g, ''));
    return Number.isFinite(num) ? num * sign : NaN;
  };

  let lat = NaN;
  let lon = NaN;

  if (latText.includes(',') || (latText.trim().split(/[\s,]+/).length >= 2 && !lonText.trim())) {
    const parts = combined.split(/[\s,，]+/).filter(Boolean);
    if (parts.length >= 2) {
      lat = clean(parts[0]);
      lon = clean(parts[1]);
    }
  } else {
    lat = clean(latText);
    lon = clean(lonText);
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) };
}

