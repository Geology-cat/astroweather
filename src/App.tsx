import { useEffect, useMemo, useState } from 'react';
import { astroSummary } from './lib/astro';
import { DETAIL_VARS } from './lib/forecast';
import { computeNightScore } from './lib/score';
import { CURRENT_ID, FALLBACK_PLACE, loadPlaces, loadSelected, savePlaces, saveSelected, type Place } from './lib/storage';
import { addDays, defaultNightKey, type DateKey } from './lib/time';
import { useForecasts } from './lib/useForecasts';
import { AstroPanel } from './components/AstroPanel';
import { CloudMapPanel } from './components/CloudMapPanel';
import { ComparePanel } from './components/ComparePanel';
import { DetailForecastPanel } from './components/DetailForecastPanel';
import { Header } from './components/Header';
import { MapPanel } from './components/MapPanel';
import { ScoreCard } from './components/ScoreCard';

export function App() {
  const [dateKey, setDateKey] = useState<DateKey>(() => defaultNightKey());
  const [places, setPlaces] = useState<Place[]>(() => loadPlaces());
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

  const handleSelectPlace = (id: string) => {
    setSelectedId(id);
    saveSelected(id);
  };

  const handleAddPlace = (place: Place) => {
    setPlaces((prev) => {
      const next = [...prev, place];
      savePlaces(next);
      return next;
    });
  };

  const handleRemovePlace = (id: string) => {
    setPlaces((prev) => {
      const next = prev.filter((p) => p.id !== id);
      savePlaces(next);
      return next;
    });
    if (selectedId === id) handleSelectPlace(CURRENT_ID);
  };

  const astro = useMemo(() => astroSummary(activePlace, dateKey), [activePlace, dateKey]);
  const singlePoint = useMemo(() => [{ lat: activePlace.lat, lon: activePlace.lon }], [activePlace.lat, activePlace.lon]);
  const { data: detailList, loading: detailLoading, error: detailError } = useForecasts(singlePoint, DETAIL_VARS);
  const detailFc = detailList?.[0] ?? null;

  const activeScore = useMemo(() => {
    if (!detailFc || !astro.night) return null;
    return computeNightScore(detailFc, astro.night);
  }, [detailFc, astro.night]);

  return (
    <div className="app-shell">
      <Header
        dateKey={dateKey}
        onShiftDate={(d) => setDateKey((k) => addDays(k, d))}
        onToday={() => setDateKey(defaultNightKey())}
        place={activePlace}
        places={places}
        currentPlace={currentPlace}
        onSelectPlace={handleSelectPlace}
        astro={astro}
      />

      <div className="dashboard-top">
        <div className="col-astro">
          <AstroPanel astro={astro} />
        </div>
        <div className="col-score">
          <ScoreCard score={activeScore} fc={detailFc} win={astro.night} loading={detailLoading} error={detailError} />
        </div>
      </div>

      <MapPanel
        dateKey={dateKey}
        places={places}
        currentPlace={currentPlace}
        selectedId={activePlace.id}
        onSelectPlace={handleSelectPlace}
        onAddPlace={handleAddPlace}
        onRemovePlace={handleRemovePlace}
      />

      <ComparePanel
        dateKey={dateKey}
        places={places}
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
        currentPlace={currentPlace}
        selectedId={activePlace.id}
        onSelectPlace={handleSelectPlace}
      />

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
    </div>
  );
}

