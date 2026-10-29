import { describe, expect, it } from 'vitest';
import { parseLatLonInput } from './geocode';

describe('parseLatLonInput', () => {
  it('通常の緯度・経度入力', () => {
    expect(parseLatLonInput('43.4792', '142.1478')).toEqual({ lat: 43.4792, lon: 142.1478 });
  });

  it('緯度欄へのカンマ区切り一括ペースト・方位記号付きにも対応', () => {
    expect(parseLatLonInput('43.08°N, 141.35°E', '')).toEqual({ lat: 43.08, lon: 141.35 });
    expect(parseLatLonInput('35.6895 139.6917', '')).toEqual({ lat: 35.6895, lon: 139.6917 });
  });

  it('範囲外・不正値は null', () => {
    expect(parseLatLonInput('95', '140')).toBeNull();
    expect(parseLatLonInput('abc', '140')).toBeNull();
  });
});

