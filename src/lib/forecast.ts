// Open-Meteo Forecast API からモデル別の時系列予報を取得する。
// 予報値は加工せず、モデルごとの配列のまま保持する。

export const MODELS = ['jma_msm', 'ecmwf_ifs', 'gfs_seamless', 'icon_seamless'] as const;
export type ModelId = (typeof MODELS)[number];

export const MODEL_LABEL: Record<ModelId, string> = {
  jma_msm: 'MSM',
  ecmwf_ifs: 'ECMWF',
  gfs_seamless: 'GFS',
  icon_seamless: 'ICON',
};

export const MODEL_COLOR: Record<ModelId, string> = {
  jma_msm: '#7fd1ae',
  ecmwf_ifs: '#8fb4ff',
  gfs_seamless: '#f2b56b',
  icon_seamless: '#d79bf0',
};

/** 比較画面用（夜間晴天スコア＋参考値）の変数 */
export const COMPARE_VARS = ['cloud_cover', 'precipitation', 'wind_speed_10m', 'temperature_2m', 'dew_point_2m'] as const;

/** 地点詳細用の変数 */
export const DETAIL_VARS = [
  ...COMPARE_VARS,
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'relative_humidity_2m',
  'wind_gusts_10m',
] as const;

export type VarName = (typeof DETAIL_VARS)[number];

export interface LocationForecast {
  lat: number;
  lon: number;
  elevation: number;
  /** 各時刻（毎時、UTC ミリ秒） */
  time: number[];
  /** series[変数][モデル] = 値の配列（欠測は null） */
  series: Partial<Record<VarName, Record<ModelId, (number | null)[]>>>;
  fetchedAt: number;
}

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_PREFIX = 'aw.fc.';

interface RawLocation {
  latitude: number;
  longitude: number;
  elevation: number;
  hourly: Record<string, (number | null)[]> & { time: number[] };
}

export function buildUrl(points: { lat: number; lon: number }[], vars: readonly string[]): string {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: points.map((p) => p.lon.toFixed(4)).join(','),
    hourly: vars.join(','),
    models: MODELS.join(','),
    timezone: 'Asia/Tokyo',
    timeformat: 'unixtime',
    wind_speed_unit: 'ms',
    past_days: '1',
    forecast_days: '8',
  });
  return `${ENDPOINT}?${params.toString()}`;
}

export function parseResponse(json: unknown, vars: readonly string[]): LocationForecast[] {
  const list = (Array.isArray(json) ? json : [json]) as RawLocation[];
  const fetchedAt = Date.now();
  return list.map((raw) => {
    const series: LocationForecast['series'] = {};
    for (const v of vars as VarName[]) {
      const byModel = {} as Record<ModelId, (number | null)[]>;
      for (const m of MODELS) {
        byModel[m] = raw.hourly[`${v}_${m}`] ?? raw.hourly.time.map(() => null);
      }
      series[v] = byModel;
    }
    return {
      lat: raw.latitude,
      lon: raw.longitude,
      elevation: raw.elevation,
      time: raw.hourly.time.map((t) => t * 1000),
      series,
      fetchedAt,
    };
  });
}

function readCache(url: string): LocationForecast[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + url);
    if (!raw) return null;
    const data = JSON.parse(raw) as LocationForecast[];
    if (!data.length || Date.now() - data[0].fetchedAt > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(url: string, data: LocationForecast[]) {
  try {
    // 古いキャッシュを掃除してから保存
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CACHE_PREFIX)) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? '[]') as LocationForecast[];
      if (!v.length || Date.now() - v[0].fetchedAt > CACHE_TTL_MS) localStorage.removeItem(k);
    }
    localStorage.setItem(CACHE_PREFIX + url, JSON.stringify(data));
  } catch {
    // 容量超過などは無視（キャッシュなしで動く）
  }
}

const inflight = new Map<string, Promise<LocationForecast[]>>();

/** 複数地点の予報を 1 リクエストで取得（30 分キャッシュ） */
export async function fetchForecasts(
  points: { lat: number; lon: number }[],
  vars: readonly string[],
): Promise<LocationForecast[]> {
  if (!points.length) return [];
  const url = buildUrl(points, vars);
  const cached = readCache(url);
  if (cached) return cached;
  const running = inflight.get(url);
  if (running) return running;
  const p = (async () => {
    const res = await fetch(url);
    if (!res.ok) {
      let reason = `${res.status}`;
      try {
        reason = ((await res.json()) as { reason?: string }).reason ?? reason;
      } catch {
        /* noop */
      }
      throw new Error(`Open-Meteo の取得に失敗しました（${reason}）`);
    }
    const data = parseResponse(await res.json(), vars);
    writeCache(url, data);
    return data;
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
