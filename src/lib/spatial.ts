// Open-Meteo Spatial Data（S3 上の .om 格子データ）のメタ情報取得と URL 組み立て。
// weather-map-layer（omProtocol）で雲量マップを描画するために使う。

export type SpatialDomainId = 'jma_seamless' | 'jma_msm' | 'ecmwf_ifs' | 'ncep_gfs013' | 'dwd_icon';

export type CloudLayerVar = 'cloud_cover' | 'cloud_cover_low' | 'cloud_cover_mid' | 'cloud_cover_high';

export const SPATIAL_MODELS: { id: SpatialDomainId; metaDomain: string; label: string; note: string }[] = [
  { id: 'jma_msm', metaDomain: 'jma_msm', label: 'MSM（気象庁 5km）', note: '日本周辺・約3.5日先まで1時間ごと' },
  { id: 'jma_seamless', metaDomain: 'jma_gsm', label: 'JMA Seamless（MSM＋GSM）', note: '高ズームはMSM、広域・長期はGSM' },
  { id: 'ecmwf_ifs', metaDomain: 'ecmwf_ifs', label: 'ECMWF IFS HRES（9km）', note: '全球・高解像度' },
  { id: 'ncep_gfs013', metaDomain: 'ncep_gfs013', label: 'NOAA GFS（0.13°）', note: '全球・約13km' },
  { id: 'dwd_icon', metaDomain: 'dwd_icon', label: 'DWD ICON（11km）', note: '全球・約11km' },
];

export const CLOUD_LAYERS: { id: CloudLayerVar; label: string }[] = [
  { id: 'cloud_cover', label: '全雲量' },
  { id: 'cloud_cover_high', label: '上層雲（8km〜）' },
  { id: 'cloud_cover_mid', label: '中層雲（3〜8km）' },
  { id: 'cloud_cover_low', label: '下層雲（〜3km）' },
];

export interface SpatialMeta {
  referenceTime: number;
  validTimes: number[];
}

const S3_BASE = 'https://openmeteo.s3.amazonaws.com/data_spatial';
const metaCache = new Map<string, { meta: SpatialMeta; fetchedAt: number }>();

const pad2 = (n: number) => String(n).padStart(2, '0');

function formatRunPath(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}/${pad2(d.getUTCHours())}00Z`;
}

function formatValidFile(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}00.om`;
}

/** S3 の latest.json から初期時刻と有効時刻一覧を取得する（10分メモリキャッシュ） */
export async function fetchSpatialMeta(domainId: SpatialDomainId): Promise<SpatialMeta> {
  const cfg = SPATIAL_MODELS.find((m) => m.id === domainId) ?? SPATIAL_MODELS[0];
  const cached = metaCache.get(cfg.metaDomain);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
    return cached.meta;
  }
  const res = await fetch(`${S3_BASE}/${cfg.metaDomain}/latest.json`);
  if (!res.ok) {
    throw new Error(`雲量マップのメタデータ取得に失敗しました (${res.status})`);
  }
  const raw = (await res.json()) as { reference_time: string; valid_times: string[] };
  const validTimes = (raw.valid_times ?? [])
    .map((s) => Date.parse(s))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const meta: SpatialMeta = {
    referenceTime: Date.parse(raw.reference_time),
    validTimes,
  };
  metaCache.set(cfg.metaDomain, { meta, fetchedAt: Date.now() });
  return meta;
}

/** 目標時刻に最も近い validTime を返す */
export function nearestValidTime(validTimes: number[], targetMs: number): number | null {
  if (!validTimes.length) return null;
  let best = validTimes[0];
  let bestDiff = Math.abs(best - targetMs);
  for (const t of validTimes) {
    const diff = Math.abs(t - targetMs);
    if (diff < bestDiff) {
      best = t;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * weather-map-layer 用の om:// URL を直接組み立てる（latest.json の再フェッチ遅延を省く）。
 * jma_seamless のようなシームレスドメインの場合は latest.json + valid_times_N 形式を使う。
 */
export function buildOmTileUrl(
  domainId: SpatialDomainId,
  meta: SpatialMeta,
  validTimeMs: number,
  variable: CloudLayerVar,
  dark = true,
): string {
  const params = new URLSearchParams({
    variable,
    dark: dark ? 'true' : 'false',
  });
  if (domainId === 'jma_seamless') {
    const idx = Math.max(0, meta.validTimes.indexOf(validTimeMs));
    params.set('time_step', `valid_times_${idx}`);
    return `om://${S3_BASE}/${domainId}/latest.json?${params.toString()}`;
  }
  const runPath = formatRunPath(meta.referenceTime);
  const file = formatValidFile(validTimeMs);
  return `om://${S3_BASE}/${domainId}/${runPath}/${file}?${params.toString()}`;
}

