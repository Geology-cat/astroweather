import type { AstroSummary, BodyEvents, NightSegment } from '../lib/astro';
import { addDays, formatDateShort, formatDuration, formatMD, formatTime, type DateKey } from '../lib/time';

function EventRows({ ev, base, name }: { ev: BodyEvents; base: DateKey; name: '日' | '月' }) {
  return (
    <dl className="kv">
      <dt>{name}の出</dt>
      <dd>{formatTime(ev.rise, base)}</dd>
      <dt>南中</dt>
      <dd>
        {ev.transit ? (
          <>
            {formatTime(ev.transit.time, base)} <span className="sub">({ev.transit.altitude.toFixed(1)}°)</span>
          </>
        ) : (
          '—'
        )}
      </dd>
      <dt>{name}の入</dt>
      <dd>{formatTime(ev.set, base)}</dd>
    </dl>
  );
}

const SunriseIcon = ({ up }: { up: boolean }) => (
  <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden className="tw-icon">
    <path d="M5 14a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M1 16.5h24" stroke="currentColor" strokeWidth="1.6" />
    <path d="M13 1v5M10.5 3.5 13 1l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" transform={up ? undefined : 'rotate(180 13 3.5)'} />
    <path d="M3 9l2 1.2M23 9l-2 1.2M7 5l1.3 1.6M19 5l-1.3 1.6" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

function TwilightRow({ label, dateKey, dawn, dusk }: { label: string; dateKey: DateKey; dawn: Date | null; dusk: Date | null }) {
  return (
    <div className="tw-row">
      <div className="tw-label">
        <div>{label}</div>
        <div className="sub">{formatDateShort(dateKey)}</div>
      </div>
      <div className="tw-cell">
        <SunriseIcon up />
        <span className="tw-time">{dawn ? formatTime(dawn) : '終夜薄明'}</span>
      </div>
      <div className="tw-cell">
        <SunriseIcon up={false} />
        <span className="tw-time">{dusk ? formatTime(dusk) : '終夜薄明'}</span>
      </div>
    </div>
  );
}

function DarkTimeline({ segments, base }: { segments: NightSegment[]; base: DateKey }) {
  if (!segments.length) return null;
  const s0 = segments[0].start.getTime();
  const e0 = segments[segments.length - 1].end.getTime();
  const span = e0 - s0;
  return (
    <div className="timeline">
      <div className="timeline-bar">
        {segments.map((s, i) => (
          <div
            key={i}
            className={s.moonUp ? 'tl-moon' : 'tl-dark'}
            style={{ left: `${((s.start.getTime() - s0) / span) * 100}%`, width: `${((s.end.getTime() - s.start.getTime()) / span) * 100}%` }}
            title={`${s.moonUp ? '月明かり' : '暗夜'} ${formatTime(s.start, base)}〜${formatTime(s.end, base)}`}
          />
        ))}
      </div>
      <div className="timeline-axis">
        <span>{formatTime(segments[0].start, base)}</span>
        <span className="legend">
          <i className="dot dark" />暗夜 <i className="dot moon" />月明かり
        </span>
        <span>{formatTime(segments[segments.length - 1].end, base)}</span>
      </div>
    </div>
  );
}

export function AstroPanel({ astro }: { astro: AstroSummary }) {
  const base = astro.key;
  const darks = astro.segments.filter((s) => !s.moonUp);
  const kindNote =
    astro.night?.kind === 'nautical' ? '（終夜薄明のため航海薄明で代用）' : astro.night?.kind === 'sunset' ? '（日の入〜日の出で代用）' : '';
  return (
    <section className="astro-grid">
      <div className="card">
        <h2 className="card-title sun">☀ 太陽</h2>
        <EventRows ev={astro.sun} base={base} name="日" />
      </div>
      <div className="card">
        <h2 className="card-title moon">☾ 月</h2>
        <EventRows ev={astro.moon} base={base} name="月" />
      </div>

      <div className="card span-2">
        <h2 className="card-title twi">✦ 天文薄明</h2>
        <div className="tw-head">
          <span />
          <span>朝の薄明開始</span>
          <span>夕の薄明終了</span>
        </div>
        <TwilightRow label="今日" dateKey={base} dawn={astro.twilightToday.dawn} dusk={astro.twilightToday.dusk} />
        <div className="divider" />
        <TwilightRow label="明日" dateKey={addDays(base, 1)} dawn={astro.twilightTomorrow.dawn} dusk={astro.twilightTomorrow.dusk} />
      </div>

      <div className="card span-2">
        <div className="dark-head">
          <h2 className="card-title dark">
            ☾ 暗夜{' '}
            <span className="sub">
              {formatMD(base)}〜{formatMD(addDays(base, 1)).split('/')[1]} の夜{kindNote}
            </span>
          </h2>
          <div className="dark-total">
            <span className="sub">計</span> {darks.length ? formatDuration(astro.darkMs) : '暗夜なし'}
          </div>
        </div>
        {darks.map((s, i) => (
          <div className="dark-seg" key={i}>
            <b>{formatTime(s.start, base)}</b> <span className="sub">{s.startReason}</span> <span className="arrow">→</span>{' '}
            <b>{formatTime(s.end, base)}</b> <span className="sub">{s.endReason}</span>
          </div>
        ))}
        {!astro.night && <div className="sub">白夜のため夜がありません</div>}
        <DarkTimeline segments={astro.segments} base={base} />
      </div>
    </section>
  );
}
