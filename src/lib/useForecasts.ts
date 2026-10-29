import { useEffect, useState } from 'react';
import { fetchForecasts, type LocationForecast } from './forecast';

interface State {
  data: LocationForecast[] | null;
  error: string | null;
  loading: boolean;
}

/** 地点リストの予報を取得するフック。points が変わると取り直す（キャッシュあり） */
export function useForecasts(points: { lat: number; lon: number }[], vars: readonly string[]): State {
  const key = JSON.stringify([points.map((p) => [p.lat.toFixed(4), p.lon.toFixed(4)]), vars]);
  const [state, setState] = useState<State>({ data: null, error: null, loading: false });

  useEffect(() => {
    if (!points.length) {
      setState({ data: [], error: null, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchForecasts(points, vars)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
