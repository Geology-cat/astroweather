import type { AstroSummary } from '../lib/astro';
import { formatDateLong, type DateKey } from '../lib/time';
import { formatLatLon, type Place } from '../lib/storage';
import { MoonIcon } from './MoonIcon';

interface Props {
  dateKey: DateKey;
  onShiftDate: (days: number) => void;
  onToday: () => void;
  place: Place;
  places: Place[];
  currentPlace: Place;
  onSelectPlace: (id: string) => void;
  astro: AstroSummary;
}

export function Header({ dateKey, onShiftDate, onToday, place, places, currentPlace, onSelectPlace, astro }: Props) {
  return (
    <header className="card header">
      <div className="header-main">
        <div className="date-row">
          <button className="round-btn" onClick={() => onShiftDate(-1)} aria-label="前の日">
            ‹
          </button>
          <h1 className="date-title" onDoubleClick={onToday} title="ダブルクリックで今夜に戻る">
            {formatDateLong(dateKey)}
          </h1>
          <button className="round-btn" onClick={() => onShiftDate(1)} aria-label="次の日">
            ›
          </button>
        </div>
        <div className="place-row">
          <span className="place-icon" aria-hidden>
            {place.id === 'current' ? '➤' : '📍'}
          </span>
          <select className="place-select" value={place.id} onChange={(e) => onSelectPlace(e.target.value)}>
            <option value={currentPlace.id}>{currentPlace.name}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="muted">{formatLatLon(place.lat, place.lon)}</span>
        </div>
      </div>
      <div className="moon-badge" title={`輝面比 ${Math.round(astro.moonInfo.illumination * 100)}%（正午）`}>
        <MoonIcon phaseAngle={astro.moonInfo.phaseAngle} size={52} />
        <div>
          <div className="moon-badge-label">月齢</div>
          <div className="moon-badge-value">{astro.moonInfo.age.toFixed(1)}</div>
        </div>
      </div>
    </header>
  );
}
