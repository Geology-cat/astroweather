import { describe, expect, it } from 'vitest';
import { nextFromMeta, nextFromSchedule, parseModelMeta } from './modelUpdates';
import { HOUR_MS, todayKey } from './time';

const T0 = Date.UTC(2026, 10, 11, 17, 28); // 2026-11-12 2:28 JST

describe('todayKey', () => {
  it('日本時間 0:00 で日付が切り替わる', () => {
    expect(todayKey(new Date(T0))).toBe('2026-11-12');
    expect(todayKey(new Date(Date.UTC(2026, 10, 11, 14, 59)))).toBe('2026-11-11');
    expect(todayKey(new Date(Date.UTC(2026, 10, 11, 15, 0)))).toBe('2026-11-12');
  });
});

describe('parseModelMeta', () => {
  it('UNIX 秒をミリ秒に変換する', () => {
    expect(parseModelMeta({ last_run_availability_time: 1000, update_interval_seconds: 10800 })).toEqual({
      lastAvailableMs: 1_000_000,
      intervalMs: 10_800_000,
    });
  });
  it('項目が欠けていれば null', () => {
    expect(parseModelMeta({ last_run_availability_time: 1000 })).toBeNull();
    expect(parseModelMeta(null)).toBeNull();
  });
});

describe('nextFromMeta', () => {
  const meta = { lastAvailableMs: T0 - HOUR_MS, intervalMs: 3 * HOUR_MS };
  it('直近の公開時刻 + 更新間隔', () => {
    expect(nextFromMeta(meta, T0)).toEqual({ nextMs: T0 + 2 * HOUR_MS, overdue: false, estimated: false });
  });
  it('見込み時刻を過ぎたら更新待ち', () => {
    const r = nextFromMeta(meta, T0 + 2.5 * HOUR_MS);
    expect(r.overdue).toBe(true);
    expect(r.nextMs).toBe(T0 + 2 * HOUR_MS);
  });
  it('メタデータが何回分も古ければ直近の見込みまで進める', () => {
    const r = nextFromMeta(meta, T0 + 7 * HOUR_MS);
    expect(r.nextMs).toBe(T0 + 5 * HOUR_MS);
  });
});

describe('nextFromSchedule', () => {
  it('常に現在より後の時刻を返す', () => {
    for (const m of ['jma_msm', 'ecmwf_ifs', 'gfs_seamless', 'icon_seamless'] as const) {
      const r = nextFromSchedule(m, T0);
      expect(r.nextMs).toBeGreaterThan(T0);
      expect(r.estimated).toBe(true);
    }
  });
  it('MSM は 3 時間ごと（UTC 0,3,6…時初期値 + 2.5 時間）', () => {
    // 17:28 UTC → 公開済み最新は 12Z（14:30 公開）、次は 15Z の 17:30 UTC
    expect(nextFromSchedule('jma_msm', T0).nextMs).toBe(Date.UTC(2026, 10, 11, 17, 30));
  });
});
