import { clearColor } from '../lib/score';
import { HOUR_MS, formatHM } from '../lib/time';

interface Props {
  /** 毎時の晴れ度 */
  hours: { time: number; clear: number | null }[];
  /** 表示する時刻軸の範囲 */
  axisStart: number;
  axisEnd: number;
  /** 集計窓（外側は薄く表示） */
  windowStart: number;
  windowEnd: number;
  showAxis?: boolean;
}

/** 3 時間ごとの目盛り（ストリップの下や表のヘッダーに置く） */
export function StripAxis({ axisStart, axisEnd }: { axisStart: number; axisEnd: number }) {
  const span = axisEnd - axisStart;
  const ticks: number[] = [];
  for (let t = Math.ceil(axisStart / (3 * HOUR_MS)) * 3 * HOUR_MS; t <= axisEnd; t += 3 * HOUR_MS) ticks.push(t);
  return (
    <div className="strip-axis mono" aria-hidden>
      {ticks.map((t) => {
        const p = ((t - axisStart) / span) * 100;
        // 両端のラベルははみ出さないよう内側に寄せる
        const shift = p < 4 ? '0%' : p > 96 ? '-100%' : '-50%';
        return (
          <span key={t} style={{ left: `${p}%`, transform: `translateX(${shift})` }}>
            {formatHM(new Date(t))}
          </span>
        );
      })}
    </div>
  );
}

/** 晴れ度の時間帯ストリップ。各毎時値は前後 30 分を代表するセルとして描く */
export function ClearStrip({ hours, axisStart, axisEnd, windowStart, windowEnd, showAxis }: Props) {
  const span = axisEnd - axisStart;
  const pct = (t: number) => `${((t - axisStart) / span) * 100}%`;
  return (
    <div className="strip-wrap">
      <div className="strip">
        {hours.map(({ time, clear }) => {
          const s = Math.max(time - HOUR_MS / 2, axisStart);
          const e = Math.min(time + HOUR_MS / 2, axisEnd);
          if (e <= s) return null;
          return (
            <div
              key={time}
              className="strip-cell"
              style={{ left: pct(s), width: `${((e - s) / span) * 100}%`, background: clearColor(clear) }}
              title={`${formatHM(new Date(time))} 晴れ度 ${clear == null ? '—' : Math.round(clear)}`}
            />
          );
        })}
        {/* 集計窓の外を暗くするマスク */}
        <div className="strip-mask" style={{ left: 0, width: pct(windowStart) }} />
        <div className="strip-mask" style={{ left: pct(windowEnd), right: 0 }} />
        <div className="strip-edge" style={{ left: pct(windowStart) }} />
        <div className="strip-edge" style={{ left: pct(windowEnd) }} />
      </div>
      {showAxis && <StripAxis axisStart={axisStart} axisEnd={axisEnd} />}
    </div>
  );
}
