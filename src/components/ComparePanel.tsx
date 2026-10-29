import { useMemo, useState } from 'react';
import { nightWindow } from '../lib/astro';
import { COMPARE_VARS, MODELS, MODEL_LABEL } from '../lib/forecast';
import { computeNightScore, hourlyClear, scoreColor } from '../lib/score';
import { formatLatLon, type Place } from '../lib/storage';
import { HOUR_MS, formatDuration, formatHM, jstNoon, type DateKey } from '../lib/time';
import { useForecasts } from '../lib/useForecasts';
import { ClearStrip, StripAxis } from './ClearStrip';
import { CardTitle, Icon } from './Icon';
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
  const [includeCurrent, setIncludeCurrent] = useState(false);

  const list = useMemo(() => (includeCurrent ? [currentPlace, ...places] : places), [includeCurrent, currentPlace, places]);
  const { data: forecasts, loading, error } = useForecasts(list, COMPARE_VARS);

  // 全地点で共通の時刻軸（対象日の 17:00 〜 翌 06:00 JST）
  const noonMs = jstNoon(dateKey).getTime();
  const axisStart = noonMs + 5 * HOUR_MS; // 17:00
  const axisEnd = noonMs + 18 * HOUR_MS; // 翌 06:00

  // 天文計算とスコア計算は地点・日付・予報が変わったときだけやり直す
  const rows = useMemo(
    () =>
      list.map((place, idx) => {
        const win = nightWindow(place, dateKey);
        const fc = forecasts?.[idx] ?? null;
        const ns = fc && win ? computeNightScore(fc, win) : null;
        return { place, idx, win, fc, ns };
      }),
    [list, dateKey, forecasts],
  );

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
      <div className="card-head">
        <div className="head-text">
          <CardTitle icon="ranking" tone="compare">
            複数地点比較<span className="title-sub">夜間晴天スコア</span>
          </CardTitle>
          <p className="card-desc">天文薄明終了〜開始の全雲量・降水のみから算出（光害・月明かりは含みません）。行をクリックするとその地点を選択します。</p>
        </div>
        <div className="head-controls">
          <label className="check">
            <input type="checkbox" checked={includeCurrent} onChange={(e) => setIncludeCurrent(e.target.checked)} />
            <span>現在地を含める</span>
          </label>
          <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} aria-label="並び替え">
            <option value="score">スコア順</option>
            <option value="clearMs">晴れ時間順</option>
            <option value="order">登録順</option>
            <option value="name">名前順</option>
          </select>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && !forecasts && <div className="loading-line">複数地点の予報を一括取得中…</div>}
      {!list.length && <div className="empty-state">登録された観測地点がありません。上の観測地点Mapから地点を登録してください。</div>}

      {list.length > 0 && (
        <div className="table-scroll framed">
          <table className="compare-table">
            <thead>
              <tr>
                <th className="sticky-col">地点</th>
                <th>スコア</th>
                <th>{MODELS.map((m) => MODEL_LABEL[m]).join(' / ')}</th>
                <th>晴れ時間（最長連続）</th>
                <th className="strip-col">
                  <span>時間帯ストリップ（17:00〜翌6:00 共通軸）</span>
                  <StripAxis axisStart={axisStart} axisEnd={axisEnd} />
                </th>
                <th>薄明窓</th>
                <th>参考：最大風速・最小露点差</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ place, win, fc, ns }) => {
                const isSelected = place.id === selectedId;
                return (
                  <tr
                    key={place.id}
                    className={isSelected ? 'is-selected' : ''}
                    onClick={() => onSelectPlace(place.id)}
                    title="クリックでこの地点の詳細予報を表示"
                  >
                    <td className="sticky-col">
                      <div className="place-cell">
                        <span className="place-name">
                          {place.id === 'current' && <Icon name="locate" size={13} />}
                          {place.name}
                        </span>
                        <span className="muted mono">{formatLatLon(place.lat, place.lon)}</span>
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
                              {mi > 0 && <span className="sep">/</span>}
                              <b style={{ color: scoreColor(ns.modelScores[m]) }}>{ns.modelScores[m] ?? '—'}</b>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono">
                      {ns ? (
                        <>
                          <b>{formatDuration(ns.clearMs)}</b>{' '}
                          <span className="muted">
                            ({ns.longestClear ? `${formatHM(new Date(ns.longestClear.start))}–${formatHM(new Date(ns.longestClear.end))}` : 'なし'})
                          </span>
                        </>
                      ) : (
                        <span className="muted">—</span>
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
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono muted">{win ? `${formatHM(win.start)}–${formatHM(win.end)}` : '—'}</td>
                    <td className="mono muted">
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
