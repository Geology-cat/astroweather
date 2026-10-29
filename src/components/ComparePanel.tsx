import { useState } from 'react';
import { nightWindow } from '../lib/astro';
import { COMPARE_VARS, MODELS, MODEL_LABEL } from '../lib/forecast';
import { computeNightScore, hourlyClear, scoreColor } from '../lib/score';
import { formatLatLon, type Place } from '../lib/storage';
import { HOUR_MS, formatDuration, formatHM, jstNoon, type DateKey } from '../lib/time';
import { useForecasts } from '../lib/useForecasts';
import { ClearStrip } from './ClearStrip';
import { ScoreBadge } from './ScoreCard';

interface Props {
  dateKey: DateKey;
  places: Place[];
  currentPlace: Place;
  selectedId: string;
  onSelectPlace: (id: string) => void;
}

type SortKey = 'score' | 'clearMs' | 'order' | 'name';

/** 複数地点比較パネル（夜間晴天スコアによる一覧・共通時刻軸ストリップ） */
export function ComparePanel({ dateKey, places, currentPlace, selectedId, onSelectPlace }: Props) {
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [includeCurrent, setIncludeCurrent] = useState(true);

  const list = includeCurrent ? [currentPlace, ...places] : places;
  const { data: forecasts, loading, error } = useForecasts(list, COMPARE_VARS);

  // 全地点で共通の時刻軸（対象日の 17:00 〜 翌 06:00 JST）
  const noonMs = jstNoon(dateKey).getTime();
  const axisStart = noonMs + 5 * HOUR_MS; // 17:00
  const axisEnd = noonMs + 18 * HOUR_MS; // 翌 06:00

  const rows = list.map((place, idx) => {
    const win = nightWindow(place, dateKey);
    const fc = forecasts?.[idx] ?? null;
    const ns = fc && win ? computeNightScore(fc, win) : null;
    return { place, idx, win, fc, ns };
  });

  const sorted = [...rows].sort((a, b) => {
    if (sortBy === 'score') {
      return (b.ns?.score ?? -1) - (a.ns?.score ?? -1);
    }
    if (sortBy === 'clearMs') {
      return (b.ns?.clearMs ?? -1) - (a.ns?.clearMs ?? -1);
    }
    if (sortBy === 'name') {
      return a.place.name.localeCompare(b.place.name, 'ja');
    }
    return a.idx - b.idx;
  });

  return (
    <section className="card">
      <div className="panel-head">
        <div>
          <h2 className="card-title compare">★ 複数地点比較（夜間晴天スコア）</h2>
          <p className="sub">天文薄明終了〜開始の全雲量・降水のみから算出（光害・月明かりは含みません）</p>
        </div>
        <div className="panel-controls">
          <label className="chk-label">
            <input type="checkbox" checked={includeCurrent} onChange={(e) => setIncludeCurrent(e.target.checked)} />
            現在地を含める
          </label>
          <select className="ctrl-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} aria-label="並び替え">
            <option value="score">スコア順</option>
            <option value="clearMs">晴れ時間順</option>
            <option value="order">登録順</option>
            <option value="name">名前順</option>
          </select>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && !forecasts && <div className="sub">複数地点の予報を一括取得中…</div>}
      {!list.length && <div className="sub">登録地点がありません。下の地図をクリックするか設定から追加してください。</div>}

      {list.length > 0 && (
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>地点</th>
                <th>スコア</th>
                <th>{MODELS.map((m) => MODEL_LABEL[m]).join(' / ')}</th>
                <th>晴れ時間（最長連続）</th>
                <th className="strip-col">時間帯ストリップ（17:00〜翌6:00 共通軸）</th>
                <th>薄明窓</th>
                <th>参考：最大風速・最小露点差</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ place, win, fc, ns }, i) => {
                const isSelected = place.id === selectedId;
                return (
                  <tr
                    key={place.id}
                    className={isSelected ? 'selected-row' : ''}
                    onClick={() => onSelectPlace(place.id)}
                    title="クリックでこの地点の詳細予報を表示"
                  >
                    <td>
                      <div className="place-cell">
                        <span className="place-name">
                          {place.id === 'current' ? '➤ ' : ''}
                          {place.name}
                        </span>
                        <span className="sub">{formatLatLon(place.lat, place.lon)}</span>
                      </div>
                    </td>
                    <td>
                      <ScoreBadge score={ns?.score ?? null} />
                    </td>
                    <td className="mono">
                      {ns ? (
                        <span className="model-inline">
                          {MODELS.map((m, mi) => (
                            <span key={m}>
                              {mi > 0 && <span className="sub"> / </span>}
                              <b style={{ color: scoreColor(ns.modelScores[m]) }}>{ns.modelScores[m] ?? '—'}</b>
                            </span>
                          ))}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="mono">
                      {ns ? (
                        <>
                          <b>{formatDuration(ns.clearMs)}</b>{' '}
                          <span className="sub">
                            ({ns.longestClear ? `${formatHM(new Date(ns.longestClear.start))}–${formatHM(new Date(ns.longestClear.end))}` : 'なし'})
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="strip-col">
                      {fc && win && ns ? (
                        <ClearStrip
                          hours={hourlyClear(fc, ns.usedModels, axisStart, axisEnd)}
                          axisStart={axisStart}
                          axisEnd={axisEnd}
                          windowStart={win.start.getTime()}
                          windowEnd={win.end.getTime()}
                          showAxis={i === sorted.length - 1}
                        />
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td className="mono sub">{win ? `${formatHM(win.start)}–${formatHM(win.end)}` : '—'}</td>
                    <td className="mono sub">
                      {ns
                        ? `${ns.maxWind == null ? '—' : `${ns.maxWind.toFixed(1)} m/s`} / ${ns.minDewSpread == null ? '—' : `Δ${ns.minDewSpread.toFixed(1)}℃`}`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
