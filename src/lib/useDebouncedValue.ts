import { useEffect, useState } from 'react';

/** 値の変化が delayMs だけ落ち着いてから反映する（スライダーのドラッグ中に重い処理を連発しないため） */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
