// 登録地点とカテゴリの状態をまとめて扱うフック（変更のたびに localStorage へ保存する）。
import { useCallback, useMemo, useState } from 'react';
import {
  MAX_CATEGORY_NAME_LENGTH,
  UNCATEGORIZED,
  categoryOf,
  loadCategories,
  loadHiddenCategories,
  loadPlaces,
  newCategoryId,
  saveCategories,
  saveHiddenCategories,
  savePlaces,
  type Category,
  type Place,
} from './storage';

/** カテゴリ ID を地点に設定する（未分類なら categoryId を持たせない） */
const withCategory = (p: Place, categoryId: string): Place => {
  const next: Place = { id: p.id, name: p.name, lat: p.lat, lon: p.lon };
  if (categoryId !== UNCATEGORIZED) next.categoryId = categoryId;
  return next;
};

export interface PlaceStore {
  places: Place[];
  categories: Category[];
  hiddenCategoryIds: string[];
  /** 地図に表示しない地点の ID（非表示カテゴリに属するもの） */
  hiddenPlaceIds: ReadonlySet<string>;
  addPlaces: (list: Place[]) => void;
  removePlaces: (ids: string[]) => void;
  movePlaces: (ids: string[], categoryId: string) => void;
  addCategory: (name: string) => Category;
  renameCategory: (id: string, name: string) => void;
  /** カテゴリと、そこに属する地点をまとめて削除する（UNCATEGORIZED なら未分類の地点だけを削除） */
  removeCategory: (id: string) => void;
  toggleCategoryVisible: (id: string) => void;
}

export function usePlaces(): PlaceStore {
  const [places, setPlaces] = useState<Place[]>(() => loadPlaces());
  const [categories, setCategories] = useState<Category[]>(() => loadCategories());
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<string[]>(() => loadHiddenCategories());

  const updatePlaces = useCallback((fn: (prev: Place[]) => Place[]) => {
    setPlaces((prev) => {
      const next = fn(prev);
      savePlaces(next);
      return next;
    });
  }, []);

  const updateCategories = useCallback((fn: (prev: Category[]) => Category[]) => {
    setCategories((prev) => {
      const next = fn(prev);
      saveCategories(next);
      return next;
    });
  }, []);

  const updateHidden = useCallback((fn: (prev: string[]) => string[]) => {
    setHiddenCategoryIds((prev) => {
      const next = fn(prev);
      saveHiddenCategories(next);
      return next;
    });
  }, []);

  const hiddenPlaceIds = useMemo(() => {
    const hidden = new Set(hiddenCategoryIds);
    return new Set(places.filter((p) => hidden.has(categoryOf(p, categories))).map((p) => p.id));
  }, [places, categories, hiddenCategoryIds]);

  const addPlaces = useCallback((list: Place[]) => updatePlaces((prev) => [...prev, ...list]), [updatePlaces]);

  const removePlaces = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      updatePlaces((prev) => prev.filter((p) => !set.has(p.id)));
    },
    [updatePlaces],
  );

  const movePlaces = useCallback(
    (ids: string[], categoryId: string) => {
      const set = new Set(ids);
      updatePlaces((prev) => prev.map((p) => (set.has(p.id) ? withCategory(p, categoryId) : p)));
    },
    [updatePlaces],
  );

  const addCategory = useCallback(
    (name: string) => {
      const created: Category = { id: newCategoryId(), name: name.trim().slice(0, MAX_CATEGORY_NAME_LENGTH) || '新しいカテゴリ' };
      updateCategories((prev) => [...prev, created]);
      return created;
    },
    [updateCategories],
  );

  const renameCategory = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim().slice(0, MAX_CATEGORY_NAME_LENGTH);
      if (!trimmed) return;
      updateCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
    },
    [updateCategories],
  );

  const removeCategory = useCallback(
    (id: string) => {
      updatePlaces((prev) => prev.filter((p) => categoryOf(p, categories) !== id));
      if (id !== UNCATEGORIZED) updateCategories((prev) => prev.filter((c) => c.id !== id));
      updateHidden((prev) => (id === UNCATEGORIZED ? prev : prev.filter((h) => h !== id)));
    },
    [categories, updatePlaces, updateCategories, updateHidden],
  );

  const toggleCategoryVisible = useCallback(
    (id: string) => updateHidden((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id])),
    [updateHidden],
  );

  return {
    places,
    categories,
    hiddenCategoryIds,
    hiddenPlaceIds,
    addPlaces,
    removePlaces,
    movePlaces,
    addCategory,
    renameCategory,
    removeCategory,
    toggleCategoryVisible,
  };
}
