import type { NightWindow } from '../lib/astro';
import { MODELS, MODEL_LABEL, type LocationForecast } from '../lib/forecast';
import { hourlyClear, scoreColor, type NightScore } from '../lib/score';
import { HOUR_MS, formatDuration, formatHM } from '../lib/time';
import { ClearStrip } from './ClearStrip';

const KIND_LABEL = { astronomical: '天文薄明', nautical: '航海薄明（終夜薄明のため代用）', sunset: '日の入〜日の出（代用）' };

export function ScoreBadge({ score, size = 'md' }: { score: number | null; size?: 'md' | 'lg' }) {
  return (
    <span className={`score-badge ${size}`} style={{ borderColor: scoreColor(score), color: scoreColor(score) }}>
      {score ?? '—'}
    </span>
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
    <section className="card">
      <div className="score-head">
        <h2 className="card-title score">☁ 夜間晴天スコア</h2>
        {win && (
          <span className="sub">
            {formatHM(win.start)}〜{formatHM(win.end)}（{KIND_LABEL[win.kind]}）
          </span>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {loading && !score && <div className="sub">予報を取得中…</div>}
      {!win && <div className="sub">夜がないため計算できません</div>}
      {score && win && fc && (
        <>
          <div className="score-body">
            <ScoreBadge score={score.score} size="lg" />
            <div className="score-facts">
              <div>
                <span className="sub">晴れ時間</span> <b>{formatDuration(score.clearMs)}</b>
              </div>
              <div>
                <span className="sub">最長連続</span>{' '}
                <b>{score.longestClear ? `${formatHM(new Date(score.longestClear.start))}–${formatHM(new Date(score.longestClear.end))}` : 'なし'}</b>
              </div>
              <div className="model-scores">
                {MODELS.map((m) => (
                  <span key={m} className="model-score">
                    <span className="sub">{MODEL_LABEL[m]}</span> <b style={{ color: scoreColor(score.modelScores[m]) }}>{score.modelScores[m] ?? '—'}</b>
                  </span>
                ))}
                <span className="sub">（{score.usedModels.length}/{MODELS.length}モデル）</span>
              </div>
            </div>
          </div>
          <ClearStrip
            hours={hourlyClear(fc, score.usedModels, axisStart, axisEnd)}
            axisStart={axisStart}
            axisEnd={axisEnd}
            windowStart={win.start.getTime()}
            windowEnd={win.end.getTime()}
            showAxis
          />
          <div className="ref-values sub">
            参考（点数外）：最大風速 {score.maxWind == null ? '—' : `${score.maxWind.toFixed(1)} m/s`}・最小の気温−露点差{' '}
            {score.minDewSpread == null ? '—' : `${score.minDewSpread.toFixed(1)} ℃`}
          </div>
          <p className="note">このスコアは雲量と降水の予報だけから計算しています。光害・月明かり・透明度は含みません。</p>
        </>
      )}
    </section>
  );
}
