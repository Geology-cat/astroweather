import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { astroSummary } from './lib/astro';
import { DETAIL_VARS } from './lib/forecast';
import { computeNightScore } from './lib/score';
import { CURRENT_ID, FALLBACK_PLACE, loadSelected, saveSelected, type Place } from './lib/storage';
import { useModelNextUpdates } from './lib/modelUpdates';
import { addDays, toDateKey, type DateKey } from './lib/time';
import { useForecasts } from './lib/useForecasts';
import { useNow } from './lib/useNow';
import { usePlaces } from './lib/usePlaces';
import { AstroPanel } from './components/AstroPanel';
import { CloudMapPanel } from './components/CloudMapPanel';
import { ComparePanel } from './components/ComparePanel';
import { DetailForecastPanel } from './components/DetailForecastPanel';
import { Header } from './components/Header';
import { Icon } from './components/Icon';
import { MapPanel } from './components/MapPanel';
import { ScoreCard } from './components/ScoreCard';

export function App() {
  // 現在時刻（毎分更新）。日本時間 0:00 で「今日」が切り替わる
  const now = useNow();
  const today = toDateKey(now);
  const [dateKey, setDateKey] = useState<DateKey>(today);

  // 日付が変わったとき、「今日」を表示していたなら新しい今日へ追従する（別の日を見ているときはそのまま）
  const prevTodayRef = useRef(today);
  useEffect(() => {
    const prev = prevTodayRef.current;
    if (prev === today) return;
    prevTodayRef.current = today;
    setDateKey((k) => (k === prev ? today : k));
  }, [today]);

  const nextUpdates = useModelNextUpdates(now);
  const store = usePlaces();
  const { places, categories, hiddenPlaceIds } = store;
  const [selectedId, setSelectedId] = useState<string>(() => loadSelected());
  const [currentPlace, setCurrentPlace] = useState<Place>(FALLBACK_PLACE);

  // Geolocation API で現在地を取得
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentPlace({
          id: CURRENT_ID,
          name: '現在地',
          lat: Number(pos.coords.latitude.toFixed(4)),
          lon: Number(pos.coords.longitude.toFixed(4)),
        });
      },
      () => {
        // 拒否・失敗時は既定の札幌のままにする
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, []);

  const activePlace: Place = useMemo(() => {
    if (selectedId === CURRENT_ID) return currentPlace;
    return places.find((p) => p.id === selectedId) ?? currentPlace;
  }, [selectedId, places, currentPlace]);

  // 地図マーカーの作り直しを避けるため、参照を固定しておく
  const handleSelectPlace = useCallback((id: string) => {
    setSelectedId(id);
    saveSelected(id);
  }, []);

  // 選択中の地点が削除されたら（カテゴリごとの一括削除を含む）現在地に戻す
  useEffect(() => {
    if (selectedId !== CURRENT_ID && !places.some((p) => p.id === selectedId)) handleSelectPlace(CURRENT_ID);
  }, [places, selectedId, handleSelectPlace]);

  // 今日の月齢は現在時刻で計算する。月齢は小数 1 桁表示なので、再計算は 10 分ごとで十分
  const moonClock = Math.floor(now.getTime() / 600000) * 600000;
  const astro = useMemo(() => astroSummary(activePlace, dateKey, new Date(moonClock)), [activePlace, dateKey, moonClock]);
  const singlePoint = useMemo(() => [{ lat: activePlace.lat, lon: activePlace.lon }], [activePlace.lat, activePlace.lon]);
  const { data: detailList, loading: detailLoading, error: detailError } = useForecasts(singlePoint, DETAIL_VARS);
  const detailFc = detailList?.[0] ?? null;

  const activeScore = useMemo(() => {
    if (!detailFc || !astro.night) return null;
    return computeNightScore(detailFc, astro.night);
  }, [detailFc, astro.night]);

  return (
    <div className="app">
      <Header
        dateKey={dateKey}
        today={today}
        onShiftDate={(d) => setDateKey((k) => addDays(k, d))}
        onToday={() => setDateKey(today)}
        place={activePlace}
        places={places}
        categories={categories}
        currentPlace={currentPlace}
        onSelectPlace={handleSelectPlace}
        astro={astro}
      />

      <main className="app-shell">
        <div className="overview">
          <ScoreCard
            score={activeScore}
            fc={detailFc}
            win={astro.night}
            loading={detailLoading}
            error={detailError}
            nextUpdates={nextUpdates}
            now={now}
          />
          <AstroPanel astro={astro} />
        </div>

        <MapPanel
          dateKey={dateKey}
          store={store}
          currentPlace={currentPlace}
          selectedId={activePlace.id}
          onSelectPlace={handleSelectPlace}
        />

        <ComparePanel
          dateKey={dateKey}
          places={places}
          hiddenPlaceIds={hiddenPlaceIds}
          currentPlace={currentPlace}
          selectedId={activePlace.id}
          onSelectPlace={handleSelectPlace}
        />

        <DetailForecastPanel
          fc={detailFc}
          astro={astro}
          loading={detailLoading}
          error={detailError}
          placeName={activePlace.name}
        />

        <CloudMapPanel
          dateKey={dateKey}
          places={places}
          hiddenPlaceIds={hiddenPlaceIds}
          currentPlace={currentPlace}
          selectedId={activePlace.id}
          onSelectPlace={handleSelectPlace}
        />

        <a className="guide-link" href={`${import.meta.env.BASE_URL}guide.html`}>
          <span className="guide-link-icon">
            <Icon name="book" size={20} />
          </span>
          <span className="guide-link-text">
            <b>解説ページ</b>
            <span className="muted">夜間晴天スコアの算出方法と、予報データ（Open-Meteo・4 つの数値予報モデル）について</span>
          </span>
          <Icon name="chevronRight" size={18} className="guide-link-arrow" />
        </a>

        <footer className="app-footer">
          <span>
            気象・空間データ:{' '}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo.com
            </a>{' '}
            /{' '}
            <a href="https://registry.opendata.aws/open-meteo/" target="_blank" rel="noreferrer">
              Open-Meteo Spatial Data
            </a>{' '}
            (CC BY 4.0 / JMA MSM, ECMWF IFS, NOAA GFS, DWD ICON)
          </span>
          <span>
            地図:{' '}
            <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">
              国土地理院（地理院タイル）
            </a>{' '}
            / © OpenStreetMap contributors
          </span>
          <span>天文計算: Astronomy Engine (ブラウザ内計算)</span>
        </footer>
      </main>
    </div>
  );
}
