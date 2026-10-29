import { describe, expect, it } from 'vitest';
import { astroSummary } from './astro';
import { formatTime, formatDuration } from './time';

// 参照値：添付ダッシュボード（札幌付近 43.08°N, 141.35°E, 2026-10-29）
describe('astroSummary（札幌 2026-10-29）', () => {
  const p = { lat: 43.08, lon: 141.35 };
  const key = '2026-10-29';
  const s = astroSummary(p, key);
  const near = (d: Date | null | undefined, hm: string, base = key) => {
    expect(d).toBeTruthy();
    const got = formatTime(d!, base).replace(/^翌 /, '');
    const [gh, gm] = got.split(':').map(Number);
    const [eh, em] = hm.split(':').map(Number);
    // 計算方式の差で ±2 分まで許容
    expect(Math.abs(gh * 60 + gm - (eh * 60 + em))).toBeLessThanOrEqual(2);
  };

  it('太陽', () => {
    near(s.sun.rise, '6:04');
    near(s.sun.transit?.time, '11:18');
    expect(s.sun.transit!.altitude).toBeCloseTo(33.5, 0);
    near(s.sun.set, '16:31');
  });

  it('月', () => {
    near(s.moon.rise, '18:21');
    near(s.moon.transit?.time, '2:39');
    expect(formatTime(s.moon.transit!.time, key).startsWith('翌')).toBe(true);
    expect(s.moon.transit!.altitude).toBeCloseTo(74.5, 0);
    near(s.moon.set, '10:56');
    expect(s.moonInfo.age).toBeGreaterThan(17.6);
    expect(s.moonInfo.age).toBeLessThan(18.6);
  });

  it('天文薄明', () => {
    near(s.twilightToday.dawn, '4:29');
    near(s.twilightToday.dusk, '18:06');
    near(s.twilightTomorrow.dawn, '4:30', '2026-10-30');
    near(s.twilightTomorrow.dusk, '18:05', '2026-10-30');
  });

  it('暗夜（薄明終了 → 月の出）', () => {
    expect(s.night?.kind).toBe('astronomical');
    const dark = s.segments.filter((x) => !x.moonUp);
    expect(dark).toHaveLength(1);
    expect(dark[0].startReason).toBe('薄明終了');
    expect(dark[0].endReason).toBe('月の出');
    expect(Math.abs(s.darkMs / 60000 - 14.5)).toBeLessThan(2);
    expect(formatDuration(s.darkMs)).toMatch(/^1[3-6]分$/);
  });
});
