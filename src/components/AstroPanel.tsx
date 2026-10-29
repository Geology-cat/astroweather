import type { AstroSummary, BodyEvents, NightSegment } from '../lib/astro';
import { HOUR_MS, addDays, formatDateShort, formatDuration, formatHM, formatMD, formatTime, type DateKey } from '../lib/time';
import { CardTitle } from './Icon';

function EventRows({ ev, base, name }: { ev: BodyEvents; base: DateKey; name: '日' | '月' }) {
  return (
    <dl className="kv">
      <dt>{name}の出</dt>
      <dd>{formatTime(ev.rise, base)}</dd>
      <dt>南中</dt>
      <dd>
        {ev.transit ? (
          <>
            {formatTime(ev.transit.time, base)} <span className="kv-aux">{ev.transit.altitude.toFixed(1)}°</span>
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
  <svg width="22" height="16" viewBox="0 0 26 18" aria-hidden className={up ? 'tw-icon dawn' : 'tw-icon dusk'}>
    <path d="M5 14a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M1 16.5h24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path
      d="M13 1v5M10.5 3.5 13 1l2.5 2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      transform={up ? undefined : 'rotate(180 13 3.5)'}
    />
  </svg>
);

function TwilightRow({ label, dateKey, dawn, dusk }: { label: string; dateKey: DateKey; dawn: Date | null; dusk: Date | null }) {
  return (
    <div className="tw-row">
      <div className="tw-label">
        <span className="tw-day">{label}</span>
        <span className="muted">{formatDateShort(dateKey)}</span>
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
  const pct = (t: number) => ((t - s0) / span) * 100;
  // 1 時間ごとの目盛り線と、2 時間ごとの時刻ラベル（両端の時刻と重なるものは省く）
  const hours: number[] = [];
  for (let t = Math.ceil(s0 / HOUR_MS) * HOUR_MS; t < e0; t += HOUR_MS) hours.push(t);
  const labels = hours.filter((t) => new Date(t).getUTCHours() % 2 === 1 && pct(t) > 18 && pct(t) < 78);
  return (
    <div className="timeline">
      <div className="timeline-bar">
        {segments.map((s, i) => {
          const w = ((s.end.getTime() - s.start.getTime()) / span) * 100;
          return (
            <div
              key={i}
              className={s.moonUp ? 'tl-moon' : 'tl-dark'}
              style={{ left: `${pct(s.start.getTime())}%`, width: `${w}%` }}
              title={`${s.moonUp ? '月明かり' : '暗夜'} ${formatTime(s.start, base)}〜${formatTime(s.end, base)}`}
            >
              {w >= 22 && <span className="tl-label">{s.moonUp ? '月明かり' : '暗夜'}</span>}
            </div>
          );
        })}
        {hours.map((t) => (
          <i key={t} className="tl-tick" style={{ left: `${pct(t)}%` }} />
        ))}
      </div>
      <div className="timeline-axis mono">
        <span className="tl-end">{formatTime(segments[0].start, base)}</span>
        {labels.map((t) => (
          <span key={t} className="tl-hour" style={{ left: `${pct(t)}%` }}>
            {formatHM(new Date(t))}
          </span>
        ))}
        <span className="tl-end right">{formatTime(segments[segments.length - 1].end, base)}</span>
      </div>
      <div className="timeline-legend">
        <span className="legend">
          <i className="dot dark" />
          暗夜
        </span>
        <span className="legend">
          <i className="dot moon" />
          月明かり
        </span>
        <span className="muted">目盛り 1時間</span>
      </div>
    </div>
  );
}

/** 天文暦カード群（太陽・月・天文薄明・暗夜）。親のグリッドに直接並ぶよう、カードを 4 枚そのまま返す */
export function AstroPanel({ astro }: { astro: AstroSummary }) {
  const base = astro.key;
  const darks = astro.segments.filter((s) => !s.moonUp);
  const kindNote =
    astro.night?.kind === 'nautical' ? '（終夜薄明のため航海薄明で代用）' : astro.night?.kind === 'sunset' ? '（日の入〜日の出で代用）' : '';
  return (
    <>
      <section className="card area-sun">
        <CardTitle icon="sun" tone="sun">
          太陽
        </CardTitle>
        <EventRows ev={astro.sun} base={base} name="日" />
      </section>

      <section className="card area-moon">
        <CardTitle icon="moon" tone="moon">
          月
        </CardTitle>
        <EventRows ev={astro.moon} base={base} name="月" />
      </section>

      <section className="card area-twi">
        <CardTitle icon="twilight" tone="twi">
          天文薄明
        </CardTitle>
        <div className="tw-table">
          <div className="tw-head">
            <span />
            <span>朝の薄明開始</span>
            <span>夕の薄明終了</span>
          </div>
          <TwilightRow label="今日" dateKey={base} dawn={astro.twilightToday.dawn} dusk={astro.twilightToday.dusk} />
          <TwilightRow label="明日" dateKey={addDays(base, 1)} dawn={astro.twilightTomorrow.dawn} dusk={astro.twilightTomorrow.dusk} />
        </div>
      </section>

      <section className="card area-dark dark-card">
        <CardTitle icon="stars" tone="dark">
          暗夜
          <span className="title-sub">
            {formatMD(base)}〜{formatMD(addDays(base, 1)).split('/')[1]} の夜{kindNote}
          </span>
        </CardTitle>
        <div className="dark-total">
          <span className="muted">計</span>
          <span className="mono">{darks.length ? formatDuration(astro.darkMs) : '暗夜なし'}</span>
        </div>
        {darks.length > 0 && (
          <ul className="dark-segs">
            {darks.map((s, i) => (
              <li className="dark-seg" key={i}>
                <b className="mono">{formatTime(s.start, base)}</b> <span className="muted">{s.startReason}</span>
                <span className="arrow" aria-hidden>
                  →
                </span>
                <b className="mono">{formatTime(s.end, base)}</b> <span className="muted">{s.endReason}</span>
              </li>
            ))}
          </ul>
        )}
        {!astro.night && <div className="muted">白夜のため夜がありません</div>}
        <DarkTimeline segments={astro.segments} base={base} />
      </section>
    </>
  );
}
