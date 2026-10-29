import { describe, expect, it } from 'vitest';
import { isValidPlace } from './storage';

describe('isValidPlace', () => {
  const ok = { id: 'p1', name: '芦別', lat: 43.48, lon: 142.15 };

  it('正しい地点を受け入れる', () => {
    expect(isValidPlace(ok)).toBe(true);
  });

  it('壊れた・書き換えられた保存データを拒否する', () => {
    expect(isValidPlace(null)).toBe(false);
    expect(isValidPlace('p1')).toBe(false);
    expect(isValidPlace({ ...ok, id: 'x1' })).toBe(false); // 旧プリセット
    expect(isValidPlace({ ...ok, lat: Number.NaN })).toBe(false);
    expect(isValidPlace({ ...ok, lat: 91 })).toBe(false);
    expect(isValidPlace({ ...ok, lon: -181 })).toBe(false);
    expect(isValidPlace({ ...ok, lat: '43.48' })).toBe(false);
    expect(isValidPlace({ ...ok, name: 123 })).toBe(false);
    expect(isValidPlace({ ...ok, id: 'p'.repeat(100) })).toBe(false);
  });
});
