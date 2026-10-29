import { describe, expect, it } from 'vitest';
import { computeNightScore, median } from './score';
import { MODELS, type LocationForecast, type ModelId } from './forecast';
import { HOUR_MS } from './time';

const T0 = Date.UTC(2026, 9, 29, 9); // 18:00 JST

/** 18:00〜翌05:00 の毎時（12 点）の擬似予報 */
function fakeForecast(cloud: Partial<Record<ModelId, (number | null)[]>>, precip?: Partial<Record<ModelId, number[]>>): LocationForecast {
  const n = 12;
  const time = Array.from({ length: n }, (_, i) => T0 + i * HOUR_MS);
  const fill = (v: number | null) => Array.from({ length: n }, () => v);
  const series: LocationForecast['series'] = {
    cloud_cover: Object.fromEntries(MODELS.map((m) => [m, cloud[m] ?? fill(null)])) as never,
    precipitation: Object.fromEntries(MODELS.map((m) => [m, precip?.[m] ?? fill(0)])) as never,
  };
  return { lat: 43, lon: 141, elevation: 0, time, series, fetchedAt: 0 };
}

const win = { start: new Date(T0), end: new Date(T0 + 10 * HOUR_MS), kind: 'astronomical' as const };

describe('median', () => {
  it('奇数・偶数', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('computeNightScore', () => {
  it('全モデル快晴なら 100、晴れ時間は窓全体', () => {
    const z = Array(12).fill(0);
    const s = computeNightScore(fakeForecast({ jma_msm: z, ecmwf_ifs: z, gfs_seamless: z, icon_seamless: z }), win);
    expect(s.score).toBe(100);
    expect(s.usedModels).toHaveLength(4);
    expect(s.clearMs).toBe(10 * HOUR_MS);
    expect(s.longestClear).toEqual({ start: win.start.getTime(), end: win.end.getTime() });
  });

  it('1 モデルだけ外れても中央値で引っ張られない', () => {
    const z = Array(12).fill(0);
    const s = computeNightScore(fakeForecast({ jma_msm: z, ecmwf_ifs: z, gfs_seamless: Array(12).fill(100), icon_seamless: z }), win);
    expect(s.score).toBe(100);
    expect(s.modelScores.gfs_seamless).toBe(0);
  });

  it('降水がある時刻は 0 点', () => {
    const z = Array(12).fill(0);
    const rain = Array(12).fill(1);
    const s = computeNightScore(
      fakeForecast({ jma_msm: z, ecmwf_ifs: z }, { jma_msm: rain, ecmwf_ifs: rain }),
      win,
    );
    expect(s.score).toBe(0);
  });

  it('予報期間外（値が少ない）モデルは除外', () => {
    const z = Array(12).fill(10);
    const partial = [10, 10, null, null, null, null, null, null, null, null, null, null];
    const s = computeNightScore(fakeForecast({ jma_msm: partial, ecmwf_ifs: z }), win);
    expect(s.usedModels).toEqual(['ecmwf_ifs']);
    expect(s.modelScores.jma_msm).toBeNull();
    expect(s.score).toBe(90);
  });

  it('前半晴れ・後半曇りの最長区間', () => {
    const c = [0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 100, 100];
    const s = computeNightScore(fakeForecast({ ecmwf_ifs: c }), win);
    // 18:00 は窓の開始なので重み 0.5、19〜22 時は 1 → 晴れ 4.5 時間
    expect(s.clearMs).toBe(4.5 * HOUR_MS);
    expect(s.longestClear).toEqual({ start: T0, end: T0 + 4.5 * HOUR_MS });
    expect(s.score).toBe(45);
  });
});
