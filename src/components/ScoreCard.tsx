import type { NightWindow } from '../lib/astro';
import { MODELS, MODEL_COLOR, MODEL_LABEL, type LocationForecast } from '../lib/forecast';
import { hourlyClear, scoreColor, type NightScore } from '../lib/score';
import { HOUR_MS, formatDuration, formatHM } from '../lib/time';
import { ClearLegend, ClearStrip } from './ClearStrip';
import { CardTitle } from './Icon';

const KIND_LABEL = { astronomical: '天文薄明', nautical: '航海薄明（終夜薄明のため代用）', sunset: '日の入〜日の出（代用）' };

export function ScoreBadge({ score }: { score: number | null }) {
  const color = scoreColor(score);
  return (
    <span className="score-badge mono" style={{ color, borderColor: color }}>
      {score ?? '—'}
    </span>
  );
}

/** スコアの円形ゲージ */
function ScoreRing({ score }: { score: number | null }) {
  const r = 42;
  const len = 2 * Math.PI * r;
  const frac = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = scoreColor(score);
  return (
    <div className="score-ring" role="img" aria-label={`夜間晴天スコア ${score ?? '—'} 点`}>
      <svg viewBox="0 0 100 100" width="104" height="104" aria-hidden>
        <circle cx="50" cy="50" r={r} className="ring-track" />
        {frac > 0 && (
          <circle
            cx="50"
            cy="50"
            r={r}
            className="ring-value"
            stroke={color}
            strokeDasharray={`${len * frac} ${len}`}
            transform="rotate(-90 50 50)"
          />
        )}
      </svg>
      <div className="ring-label">
        <span className="ring-num mono" style={{ color }}>
          {score ?? '—'}
        </span>
        <span className="ring-max">/ 100</span>
      </div>
    </div>
  );
}

interface Props {
  score: NightScore | null;
  fc: LocationForecast | null;
  win: NightWindow | null;
  loading: boolean;
  error: string | null;
}

/** 選択地点の夜間晴天スコアカード */
export function ScoreCard({ score, fc, win, loading, error }: Props) {
  const axisStart = win ? Math.floor(win.start.getTime() / HOUR_MS) * HOUR_MS - HOUR_MS : 0;
  const axisEnd = win ? Math.ceil(win.end.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS : 0;
  return (
    <section className="card area-score score-card">
      <div className="card-head">
        <CardTitle icon="gauge" tone="score">
          夜間晴天スコア
        </CardTitle>
        {win && (
          <span className="head-note mono">
            {formatHM(win.start)}〜{formatHM(win.end)}
            <span className="muted">（{KIND_LABEL[win.kind]}）</span>
          </span>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {loading && !score && <div className="loading-line">予報を取得中…</div>}
      {!win && <div className="muted">夜がないため計算できません</div>}
      {score && win && fc && (
        <div className="score-body">
          <div className="score-hero">
            <ScoreRing score={score.score} />
            <dl className="score-stats">
              <div className="stat">
                <dt>晴れ時間</dt>
                <dd className="mono">{formatDuration(score.clearMs)}</dd>
              </div>
              <div className="stat">
                <dt>最長連続</dt>
                <dd className="mono">
                  {score.longestClear ? `${formatHM(new Date(score.longestClear.start))}–${formatHM(new Date(score.longestClear.end))}` : 'なし'}
                </dd>
              </div>
            </dl>
            <div className="model-scores">
              <div className="model-scores-grid">
                {MODELS.map((m) => (
                  <span key={m} className="model-chip">
                    <i className="model-dot" style={{ background: MODEL_COLOR[m] }} />
                    <span className="model-name">{MODEL_LABEL[m]}</span>
                    <b className="mono" style={{ color: scoreColor(score.modelScores[m]) }}>
                      {score.modelScores[m] ?? '—'}
                    </b>
                  </span>
                ))}
              </div>
              <span className="muted model-count">
                使用モデル {score.usedModels.length}/{MODELS.length}
              </span>
            </div>
          </div>
          <div className="score-side">
            <div className="side-head">
              <span className="side-label">時間帯ごとの晴れ度（白線の内側が集計窓）</span>
              <ClearLegend />
            </div>
            <ClearStrip
              hours={hourlyClear(fc, score.usedModels, axisStart, axisEnd)}
              axisStart={axisStart}
              axisEnd={axisEnd}
              windowStart={win.start.getTime()}
              windowEnd={win.end.getTime()}
              showAxis
            />
            <div className="score-foot">
              <span className="ref-values">
                参考（点数外）：最大風速 <b className="mono">{score.maxWind == null ? '—' : `${score.maxWind.toFixed(1)} m/s`}</b>・最小の気温−露点差{' '}
                <b className="mono">{score.minDewSpread == null ? '—' : `${score.minDewSpread.toFixed(1)} ℃`}</b>
              </span>
              <p className="note">このスコアは雲量と降水の予報だけから計算しています。光害・月明かり・透明度は含みません。</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
