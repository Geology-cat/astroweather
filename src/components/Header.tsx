import type { AstroSummary } from '../lib/astro';
import { defaultNightKey, weekdayOf, type DateKey } from '../lib/time';
import { formatLatLon, type Place } from '../lib/storage';
import { Icon } from './Icon';
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
  const isTonight = dateKey === defaultNightKey();
  const illum = Math.round(astro.moonInfo.illumination * 100);
  const [y, m, d] = dateKey.split('-').map(Number);
  const wd = weekdayOf(dateKey);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand" aria-label="AstroWeather">
          <span className="brand-mark">
            <Icon name="stars" size={22} />
          </span>
          <span className="brand-name">AstroWeather</span>
        </div>

        <div className="date-nav">
          <button type="button" className="icon-btn" onClick={() => onShiftDate(-1)} aria-label="前の日">
            <Icon name="chevronLeft" size={20} />
          </button>
          <h1 className="date-title mono" onDoubleClick={onToday} title="ダブルクリックで今夜に戻る">
            {/* 狭い画面では年を省き、曜日を短く表示する */}
            <span className="date-year">{y}年</span>
            {m}月{d}日<span className="date-wd-long"> {wd}曜日</span>
            <span className="date-wd-short">（{wd}）</span>
          </h1>
          <button type="button" className="icon-btn" onClick={() => onShiftDate(1)} aria-label="次の日">
            <Icon name="chevronRight" size={20} />
          </button>
          <button
            type="button"
            className={isTonight ? 'today-btn is-hidden' : 'today-btn'}
            onClick={onToday}
            tabIndex={isTonight ? -1 : 0}
            aria-hidden={isTonight}
          >
            今夜
          </button>
        </div>

        <div className="place-picker">
          <span className="place-icon">
            <Icon name={place.id === 'current' ? 'locate' : 'pin'} size={19} />
          </span>
          <div className="place-stack">
            <select className="select place-select" value={place.id} onChange={(e) => onSelectPlace(e.target.value)} aria-label="地点">
              <option value={currentPlace.id}>{currentPlace.name}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="muted mono place-coord">{formatLatLon(place.lat, place.lon)}</span>
          </div>
        </div>

        <div className="moon-badge" title={`輝面比 ${illum}%（正午）`}>
          <MoonIcon phaseAngle={astro.moonInfo.phaseAngle} size={50} />
          <div className="moon-badge-text">
            <span className="moon-badge-label">月齢</span>
            <span className="moon-badge-value mono">{astro.moonInfo.age.toFixed(1)}</span>
          </div>
          <span className="moon-badge-illum mono">輝面 {illum}%</span>
        </div>
      </div>
    </header>
  );
}
