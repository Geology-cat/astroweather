import type { AstroSummary } from '../lib/astro';
import { weekdayOf, type DateKey } from '../lib/time';
import { UNCATEGORIZED, categoryOf, formatLatLon, type Category, type Place } from '../lib/storage';
import { Icon } from './Icon';
import { MoonIcon } from './MoonIcon';

interface Props {
  dateKey: DateKey;
  /** 現在の日本時間の暦日 */
  today: DateKey;
  onShiftDate: (days: number) => void;
  onToday: () => void;
  place: Place;
  places: Place[];
  categories: Category[];
  currentPlace: Place;
  onSelectPlace: (id: string) => void;
  astro: AstroSummary;
}

const placeOptions = (list: Place[]) =>
  list.map((p) => (
    <option key={p.id} value={p.id}>
      {p.name}
    </option>
  ));

export function Header({ dateKey, today, onShiftDate, onToday, place, places, categories, currentPlace, onSelectPlace, astro }: Props) {
  const isToday = dateKey === today;
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
          <h1 className="date-title mono" onDoubleClick={onToday} title="ダブルクリックで今日に戻る">
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
            className={isToday ? 'today-btn is-hidden' : 'today-btn'}
            onClick={onToday}
            tabIndex={isToday ? -1 : 0}
            aria-hidden={isToday}
          >
            今日
          </button>
        </div>

        <div className="place-picker">
          <span className="place-icon">
            <Icon name={place.id === 'current' ? 'locate' : 'pin'} size={19} />
          </span>
          <div className="place-stack">
            <select className="select place-select" value={place.id} onChange={(e) => onSelectPlace(e.target.value)} aria-label="地点">
              <option value={currentPlace.id}>{currentPlace.name}</option>
              {/* カテゴリがあればカテゴリごとにまとめる */}
              {categories.length === 0
                ? placeOptions(places)
                : [...categories, { id: UNCATEGORIZED, name: '未分類' }].map((c) => {
                    const inCat = places.filter((p) => categoryOf(p, categories) === c.id);
                    return inCat.length ? (
                      <optgroup key={c.id} label={c.name}>
                        {placeOptions(inCat)}
                      </optgroup>
                    ) : null;
                  })}
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
