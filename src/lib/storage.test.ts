import { describe, expect, it } from 'vitest';
import { UNCATEGORIZED, categoryOf, isValidCategory, isValidPlace } from './storage';

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
    expect(isValidPlace({ ...ok, categoryId: 123 })).toBe(false);
    expect(isValidPlace({ ...ok, categoryId: 'x1' })).toBe(false);
  });

  it('カテゴリ付きの地点を受け入れる', () => {
    expect(isValidPlace({ ...ok, categoryId: 'c1' })).toBe(true);
  });
});

describe('カテゴリ', () => {
  const categories = [{ id: 'c1', name: '道北' }];

  it('正しいカテゴリだけを受け入れる', () => {
    expect(isValidCategory({ id: 'c1', name: '道北' })).toBe(true);
    expect(isValidCategory({ id: 'p1', name: '道北' })).toBe(false);
    expect(isValidCategory({ id: 'c1', name: null })).toBe(false);
    expect(isValidCategory(null)).toBe(false);
  });

  it('未設定・削除済みカテゴリの地点は未分類として扱う', () => {
    const base = { id: 'p1', name: '芦別', lat: 43.48, lon: 142.15 };
    expect(categoryOf({ ...base, categoryId: 'c1' }, categories)).toBe('c1');
    expect(categoryOf(base, categories)).toBe(UNCATEGORIZED);
    expect(categoryOf({ ...base, categoryId: 'c9' }, categories)).toBe(UNCATEGORIZED);
  });
});
