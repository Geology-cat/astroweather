// 夜間晴天スコア（要件定義 2.5）。
// 天文薄明終了〜開始の集計窓内の「全雲量」と「降水」だけを使う。光害・月は一切入れない。
import type { NightWindow } from './astro';
import { HOUR_MS } from './time';
import { MODELS, type LocationForecast, type ModelId } from './forecast';

export interface ScoreOptions {
  /** この降水量（mm/h）以上の時刻は晴れ度 0 */
  precipThreshold: number;
  /** 晴れ度がこの値以上の時刻を「晴れ」とみなす（70 = 雲量 30% 以下） */
  clearThreshold: number;
  /** 集計窓のうちこの割合以上で値があるモデルだけ使う */
  minCoverage: number;
}

export const DEFAULT_SCORE_OPTIONS: ScoreOptions = {
  precipThreshold: 0.1,
  clearThreshold: 70,
  minCoverage: 0.8,
};

export interface HourSlot {
  /** 毎時の代表時刻 */
  time: number;
  /** 集計窓との重なり（時間、0〜1） */
  weight: number;
  /** 使えるモデルの晴れ度の中央値（どのモデルにも値がなければ null） */
  clear: number | null;
  /** モデル別の晴れ度 */
  byModel: Record<ModelId, number | null>;
}

export interface NightScore {
  /** 0〜100。使えるモデルがなければ null */
  score: number | null;
  /** モデル別の点数（使えないモデルは null） */
  modelScores: Record<ModelId, number | null>;
  usedModels: ModelId[];
  slots: HourSlot[];
  /** 晴れ時間（ミリ秒） */
  clearMs: number;
  /** 最長の連続晴れ区間 */
  longestClear: { start: number; end: number } | null;
  /** 参考値（点数には入れない）：夜間の最大風速（m/s、モデル中央値） */
  maxWind: number | null;
  /** 参考値：最小の気温−露点差（℃、モデル中央値） */
  minDewSpread: number | null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** モデル m・時刻 index i の晴れ度 */
function clearness(fc: LocationForecast, m: ModelId, i: number, opt: ScoreOptions): number | null {
  const c = fc.series.cloud_cover?.[m]?.[i];
  if (c == null) return null;
  const p = fc.series.precipitation?.[m]?.[i];
  if (p != null && p >= opt.precipThreshold) return 0;
  return 100 - c;
}

const weightedMean = (pairs: [number, number][]) => {
  const w = pairs.reduce((a, [, wt]) => a + wt, 0);
  return w > 0 ? pairs.reduce((a, [v, wt]) => a + v * wt, 0) / w : null;
};

export function computeNightScore(
  fc: LocationForecast,
  win: NightWindow,
  opt: ScoreOptions = DEFAULT_SCORE_OPTIONS,
): NightScore {
  const ws = win.start.getTime();
  const we = win.end.getTime();
  const totalH = (we - ws) / HOUR_MS;

  // 集計窓と重なる毎時スロット（各値は前後 30 分を代表するとみなす）
  const idx: { i: number; weight: number }[] = [];
  fc.time.forEach((t, i) => {
    const overlap = Math.min(t + HOUR_MS / 2, we) - Math.max(t - HOUR_MS / 2, ws);
    if (overlap > 0) idx.push({ i, weight: overlap / HOUR_MS });
  });

  // 使えるモデルの判定とモデル別点数
  const modelScores = {} as Record<ModelId, number | null>;
  const usedModels: ModelId[] = [];
  for (const m of MODELS) {
    const pairs: [number, number][] = [];
    for (const { i, weight } of idx) {
      const s = clearness(fc, m, i, opt);
      if (s != null) pairs.push([s, weight]);
    }
    const coveredH = pairs.reduce((a, [, w]) => a + w, 0);
    if (totalH > 0 && coveredH / totalH >= opt.minCoverage) {
      usedModels.push(m);
      modelScores[m] = weightedMean(pairs);
    } else {
      modelScores[m] = null;
    }
  }

  const medianAt = (pick: (m: ModelId, i: number) => number | null | undefined, i: number) =>
    median(usedModels.map((m) => pick(m, i)).filter((v): v is number => v != null));

  const slots: HourSlot[] = idx.map(({ i, weight }) => {
    const byModel = {} as Record<ModelId, number | null>;
    for (const m of MODELS) byModel[m] = clearness(fc, m, i, opt);
    return { time: fc.time[i], weight, clear: medianAt((m) => byModel[m], i), byModel };
  });

  const scorePairs = slots.filter((s) => s.clear != null).map((s) => [s.clear!, s.weight] as [number, number]);
  const score = usedModels.length ? weightedMean(scorePairs) : null;

  // 晴れ時間と最長連続区間
  let clearMs = 0;
  let longest: { start: number; end: number } | null = null;
  let run: { start: number; end: number } | null = null;
  for (const s of slots) {
    const isClear = usedModels.length > 0 && s.clear != null && s.clear >= opt.clearThreshold;
    if (isClear) {
      clearMs += s.weight * HOUR_MS;
      const start = Math.max(s.time - HOUR_MS / 2, ws);
      const end = Math.min(s.time + HOUR_MS / 2, we);
      run = run ? { start: run.start, end } : { start, end };
      if (!longest || run.end - run.start > longest.end - longest.start) longest = { ...run };
    } else {
      run = null;
    }
  }

  // 参考値（点数外）
  const winds = idx.map(({ i }) => medianAt((m, j) => fc.series.wind_speed_10m?.[m]?.[j], i)).filter((v): v is number => v != null);
  const spreads = idx
    .map(({ i }) =>
      medianAt((m, j) => {
        const t = fc.series.temperature_2m?.[m]?.[j];
        const d = fc.series.dew_point_2m?.[m]?.[j];
        return t != null && d != null ? t - d : null;
      }, i),
    )
    .filter((v): v is number => v != null);

  return {
    score: score == null ? null : Math.round(score),
    modelScores: Object.fromEntries(MODELS.map((m) => [m, modelScores[m] == null ? null : Math.round(modelScores[m]!)])) as Record<
      ModelId,
      number | null
    >,
    usedModels,
    slots,
    clearMs,
    longestClear: longest,
    maxWind: winds.length ? Math.max(...winds) : null,
    minDewSpread: spreads.length ? Math.min(...spreads) : null,
  };
}

/**
 * 任意の時間範囲について、毎時の晴れ度（指定モデルの中央値）を返す。
 * 比較画面の共通時刻軸ストリップ用（集計窓の外側も表示するため）。
 */
export function hourlyClear(
  fc: LocationForecast,
  models: ModelId[],
  from: number,
  to: number,
  opt: ScoreOptions = DEFAULT_SCORE_OPTIONS,
): { time: number; clear: number | null }[] {
  const out: { time: number; clear: number | null }[] = [];
  fc.time.forEach((t, i) => {
    if (t < from || t > to) return;
    const vals = models.map((m) => clearness(fc, m, i, opt)).filter((v): v is number => v != null);
    out.push({ time: t, clear: median(vals) });
  });
  return out;
}

/** 晴れ度 → 表示色（灰色＝曇り、澄んだ青＝晴れ） */
export function clearColor(v: number | null): string {
  if (v == null) return 'rgba(255,255,255,0.05)';
  const t = Math.max(0, Math.min(1, v / 100));
  // 曇り（灰）→ 晴れ（青）を線形補間
  const from = [150, 150, 150];
  const to = [64, 140, 230];
  const [r, g, b] = from.map((f, i) => Math.round(f + (to[i] - f) * t));
  return `rgb(${r},${g},${b})`;
}

/** スコア → バッジ色 */
export function scoreColor(v: number | null): string {
  if (v == null) return '#6b7280';
  if (v >= 80) return '#5fd3a5';
  if (v >= 60) return '#9fd36a';
  if (v >= 40) return '#e2c25b';
  if (v >= 20) return '#e3955a';
  return '#d86a6a';
}
