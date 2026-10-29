import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { AstroSummary } from '../lib/astro';
import { MODELS, MODEL_COLOR, MODEL_LABEL, type LocationForecast, type MetricId, type ModelId } from '../lib/forecast';
import { HOUR_MS, formatHM, jstNoon } from '../lib/time';

interface Props {
  fc: LocationForecast | null;
  astro: AstroSummary;
  loading: boolean;
  error: string | null;
  placeName: string;
}

type ViewMode = 'heatmap' | 'chart';

export interface MetricDef {
  id: MetricId;
  label: string;
  shortLabel: string;
  unit: string;
  digits: number;
  min?: number;
  max?: number;
}

/** 詳細予報で選べる全項目（Open-Meteo 取得項目＋計算項目） */
export const METRICS: MetricDef[] = [
  { id: 'clear_score', label: '晴れ度（100−全雲量、降水時0）', shortLabel: '晴れ度', unit: '点', digits: 0, min: 0, max: 100 },
  { id: 'cloud_cover', label: '全雲量', shortLabel: '全雲量', unit: '%', digits: 0, min: 0, max: 100 },
  { id: 'cloud_cover_high', label: '上層雲（8km〜）', shortLabel: '上層雲', unit: '%', digits: 0, min: 0, max: 100 },
  { id: 'cloud_cover_mid', label: '中層雲（3〜8km）', shortLabel: '中層雲', unit: '%', digits: 0, min: 0, max: 100 },
  { id: 'cloud_cover_low', label: '下層雲（〜3km）', shortLabel: '下層雲', unit: '%', digits: 0, min: 0, max: 100 },
  { id: 'precipitation', label: '降水量', shortLabel: '降水量', unit: 'mm', digits: 1, min: 0 },
  { id: 'wind_speed_10m', label: '風速（10m）', shortLabel: '風速', unit: 'm/s', digits: 1, min: 0 },
  { id: 'wind_gusts_10m', label: '最大瞬間風速（ガスト・MSMなし）', shortLabel: 'ガスト', unit: 'm/s', digits: 1, min: 0 },
  { id: 'temperature_2m', label: '気温（2m）', shortLabel: '気温', unit: '℃', digits: 1 },
  { id: 'dew_point_2m', label: '露点温度（2m）', shortLabel: '露点', unit: '℃', digits: 1 },
  { id: 'dew_spread', label: '気温−露点差 ΔT（夜露・結露リスク）', shortLabel: '露点差 ΔT', unit: '℃', digits: 1, min: 0 },
  { id: 'relative_humidity_2m', label: '相対湿度', shortLabel: '湿度', unit: '%', digits: 0, min: 0, max: 100 },
  { id: 'visibility', label: '視程（ECMWF / GFS）', shortLabel: '視程', unit: 'km', digits: 1, min: 0 },
];

/** 指定した項目・モデル・時刻インデックスの値を返す（計算項目もここで算出） */
function metricValue(fc: LocationForecast, metric: MetricId, m: ModelId, i: number): number | null {
  if (metric === 'clear_score') {
    const c = fc.series.cloud_cover?.[m]?.[i];
    if (c == null) return null;
    const p = fc.series.precipitation?.[m]?.[i];
    if (p != null && p >= 0.1) return 0;
    return 100 - c;
  }
  if (metric === 'dew_spread') {
    const t = fc.series.temperature_2m?.[m]?.[i];
    const d = fc.series.dew_point_2m?.[m]?.[i];
    return t != null && d != null ? t - d : null;
  }
  if (metric === 'visibility') {
    const v = fc.series.visibility?.[m]?.[i];
    return v == null ? null : v / 1000; // m → km
  }
  return fc.series[metric]?.[m]?.[i] ?? null;
}

/** 項目ごとのセル背景色 */
function cellStyle(metric: MetricId, val: number | null, precip: number | null | undefined) {
  if (val == null) {
    return { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)' };
  }
  // 雲量系・晴れ度
  if (
    metric === 'cloud_cover' ||
    metric === 'cloud_cover_low' ||
    metric === 'cloud_cover_mid' ||
    metric === 'cloud_cover_high' ||
    metric === 'clear_score'
  ) {
    if (precip != null && precip >= 0.1) {
      return { background: 'rgba(210, 82, 82, 0.55)', color: '#fff' };
    }
    const clear = metric === 'clear_score' ? Math.max(0, Math.min(100, val)) / 100 : 1 - Math.max(0, Math.min(100, val)) / 100;
    const r = Math.round(115 - 65 * clear);
    const g = Math.round(120 + 10 * clear);
    const b = Math.round(130 + 85 * clear);
    const a = 0.28 + 0.52 * clear;
    return { background: `rgba(${r},${g},${b},${a})`, color: '#f3f5f7' };
  }
  // 降水量
  if (metric === 'precipitation') {
    if (val < 0.1) return { background: 'rgba(64, 140, 230, 0.22)', color: '#cbd5e1' };
    const t = Math.min(1, val / 5);
    return { background: `rgba(220, 75, 75, ${0.4 + 0.45 * t})`, color: '#fff' };
  }
  // 風速・ガスト（穏やか＝緑青、強風＝橙〜赤）
  if (metric === 'wind_speed_10m' || metric === 'wind_gusts_10m') {
    if (val < 3) return { background: 'rgba(78, 180, 145, 0.32)', color: '#f3f5f7' };
    if (val < 6) return { background: 'rgba(210, 180, 75, 0.36)', color: '#f3f5f7' };
    return { background: 'rgba(215, 95, 75, 0.48)', color: '#fff' };
  }
  // 露点差 ΔT（小さいほど結露警戒＝赤〜橙、余裕あり＝青緑）
  if (metric === 'dew_spread') {
    if (val <= 1.0) return { background: 'rgba(215, 85, 85, 0.52)', color: '#fff' };
    if (val <= 2.5) return { background: 'rgba(220, 165, 70, 0.42)', color: '#f3f5f7' };
    return { background: 'rgba(70, 165, 145, 0.32)', color: '#f3f5f7' };
  }
  // 相対湿度（高湿度ほど結露注意）
  if (metric === 'relative_humidity_2m') {
    if (val >= 90) return { background: 'rgba(215, 85, 85, 0.48)', color: '#fff' };
    if (val >= 75) return { background: 'rgba(215, 165, 75, 0.35)', color: '#f3f5f7' };
    return { background: 'rgba(70, 155, 195, 0.30)', color: '#f3f5f7' };
  }
  // 視程（km：広いほど良好）
  if (metric === 'visibility') {
    if (val >= 20) return { background: 'rgba(64, 155, 210, 0.38)', color: '#f3f5f7' };
    if (val >= 10) return { background: 'rgba(130, 155, 165, 0.32)', color: '#f3f5f7' };
    return { background: 'rgba(210, 110, 85, 0.45)', color: '#fff' };
  }
  // 気温・露点温度
  const t = Math.max(0, Math.min(1, (val + 10) / 35));
  const r = Math.round(70 + 135 * t);
  const g = Math.round(130 + 20 * (1 - Math.abs(t - 0.5) * 2));
  const b = Math.round(210 - 130 * t);
  return { background: `rgba(${r},${g},${b},0.36)`, color: '#f3f5f7' };
}

export function DetailForecastPanel({ fc, astro, loading, error, placeName }: Props) {
  const [mode, setMode] = useState<ViewMode>('heatmap');
  const [metricId, setMetricId] = useState<MetricId>('cloud_cover');
  const [showAllMetrics, setShowAllMetrics] = useState<boolean>(false);
  const [summaryModel, setSummaryModel] = useState<ModelId>('jma_msm');
  const [rangeMode, setRangeMode] = useState<'night' | 'full'>('night');
  const chartRef = useRef<HTMLDivElement | null>(null);

  const activeMetric = METRICS.find((m) => m.id === metricId) ?? METRICS[1];

  const noonMs = jstNoon(astro.key).getTime();
  // 夜間モード：対象日の 15:00 〜 翌 09:00（18 時間）
  const nightStart = noonMs + 3 * HOUR_MS;
  const nightEnd = noonMs + 21 * HOUR_MS;

  useEffect(() => {
    if (mode !== 'chart' || !fc || !chartRef.current) return;
    const inst = echarts.init(chartRef.current);

    const indices: number[] = [];
    fc.time.forEach((t, i) => {
      if (rangeMode === 'full' || (t >= nightStart && t <= nightEnd)) {
        indices.push(i);
      }
    });

    const times = indices.map((i) => fc.time[i]);

    // 背景帯（暗夜＝紫、月明かり＝黄土色）
    const markAreaData = astro.segments.map((seg) => [
      {
        xAxis: seg.start.getTime(),
        itemStyle: {
          color: seg.moonUp ? 'rgba(250, 227, 158, 0.10)' : 'rgba(173, 153, 255, 0.16)',
        },
        label: {
          show: true,
          position: 'insideTop',
          formatter: seg.moonUp ? '月明かり' : '暗夜',
          color: 'rgba(255,255,255,0.55)',
          fontSize: 10,
        },
      },
      { xAxis: seg.end.getTime() },
    ]);

    const series: echarts.SeriesOption[] = MODELS.map((m: ModelId) => ({
      name: MODEL_LABEL[m],
      type: activeMetric.id === 'precipitation' ? 'bar' : 'line',
      smooth: false,
      showSymbol: rangeMode === 'night',
      symbolSize: 5,
      lineStyle: { width: 2.2, color: MODEL_COLOR[m] },
      itemStyle: { color: MODEL_COLOR[m] },
      data: indices.map((i) => {
        const v = metricValue(fc, activeMetric.id, m, i);
        return [fc.time[i], v == null ? null : Number(v.toFixed(activeMetric.digits))];
      }),
      markArea: m === 'jma_msm' && markAreaData.length ? { silent: true, data: markAreaData as never } : undefined,
    }));

    inst.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(22, 27, 34, 0.94)',
        borderColor: 'rgba(255,255,255,0.18)',
        textStyle: { color: '#eef2f6', fontSize: 12 },
      },
      legend: {
        top: 0,
        textStyle: { color: '#cbd5e1', fontSize: 12 },
      },
      grid: { left: 50, right: 18, top: 34, bottom: 32 },
      xAxis: {
        type: 'time',
        min: times[0],
        max: times[times.length - 1],
        axisLabel: {
          color: '#9ca3af',
          formatter: (val: number) => formatHM(new Date(val)),
        },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      },
      yAxis: {
        type: 'value',
        name: `${activeMetric.label} (${activeMetric.unit})`,
        nameTextStyle: { color: '#9ca3af', fontSize: 11 },
        min: activeMetric.min,
        max: activeMetric.max,
        axisLabel: { color: '#9ca3af' },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      },
      series,
    });

    const onResize = () => inst.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      inst.dispose();
    };
  }, [mode, fc, activeMetric, rangeMode, astro, nightStart, nightEnd]);

  // ヒートマップ用インデックス（対象日の 17:00 〜 翌 06:00）
  const heatIndices: number[] = [];
  if (fc) {
    const hs = noonMs + 5 * HOUR_MS;
    const he = noonMs + 18 * HOUR_MS;
    fc.time.forEach((t, i) => {
      if (t >= hs && t <= he) heatIndices.push(i);
    });
  }

  const renderTimeHeader = (label: string) => (
    <thead>
      <tr>
        <th>{label}</th>
        {fc &&
          heatIndices.map((i) => {
            const t = fc.time[i];
            const inNight = astro.night && t >= astro.night.start.getTime() - HOUR_MS / 2 && t <= astro.night.end.getTime() + HOUR_MS / 2;
            const inDark = astro.segments.some(
              (s) => !s.moonUp && t >= s.start.getTime() - HOUR_MS / 2 && t <= s.end.getTime() + HOUR_MS / 2,
            );
            return (
              <th key={t} className={inDark ? 'th-dark' : inNight ? 'th-night' : ''}>
                <div>{formatHM(new Date(t))}</div>
                <div className="th-tag">{inDark ? '暗夜' : inNight ? '月出' : '薄明'}</div>
              </th>
            );
          })}
      </tr>
    </thead>
  );

  return (
    <section className="card">
      <div className="panel-head">
        <div>
          <h2 className="card-title forecast">📈 地点別の詳細予報 — {placeName}</h2>
          <p className="sub">4モデル（MSM / ECMWF / GFS / ICON）の全取得・計算項目（雲量4種・晴れ度・降水・風速・ガスト・気温・露点・露点差ΔT・湿度・視程）を表示</p>
        </div>
        <div className="panel-controls">
          <div className="seg-group">
            <button className={mode === 'heatmap' ? 'seg active' : 'seg'} onClick={() => setMode('heatmap')}>
              ヒートマップ表
            </button>
            <button className={mode === 'chart' ? 'seg active' : 'seg'} onClick={() => setMode('chart')}>
              折れ線グラフ
            </button>
          </div>
          {mode === 'chart' && (
            <div className="seg-group">
              <button className={rangeMode === 'night' ? 'seg active' : 'seg'} onClick={() => setRangeMode('night')}>
                夜間（15時〜翌9時）
              </button>
              <button className={rangeMode === 'full' ? 'seg active' : 'seg'} onClick={() => setRangeMode('full')}>
                全期間（8日）
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 全項目ピルボタン（ヒートマップ表・折れ線グラフ共通） */}
      <div className="metric-pills" role="tablist" aria-label="表示する気象項目">
        {METRICS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={m.id === metricId ? 'metric-pill active' : 'metric-pill'}
            onClick={() => setMetricId(m.id)}
          >
            {m.shortLabel} <span className="sub">({m.unit})</span>
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {loading && !fc && <div className="sub">予報を取得中…</div>}

      {fc && mode === 'heatmap' && (
        <div className="heatmap-wrap">
          <div className="sub" style={{ marginBottom: 6 }}>
            選択中の項目: <b>{activeMetric.label}</b>（単位: {activeMetric.unit}）— 4モデル比較
          </div>
          <table className="heatmap-table">
            {renderTimeHeader('モデル / 時刻')}
            <tbody>
              {MODELS.map((m) => {
                const allNull = heatIndices.every((i) => metricValue(fc, activeMetric.id, m, i) == null);
                return (
                  <tr key={m}>
                    <td className="model-cell">
                      <span className="model-dot" style={{ background: MODEL_COLOR[m] }} />
                      <b>{MODEL_LABEL[m]}</b>
                      {allNull && <span className="sub">（対象外/期間外）</span>}
                    </td>
                    {heatIndices.map((i) => {
                      const val = metricValue(fc, activeMetric.id, m, i);
                      const precip = fc.series.precipitation?.[m]?.[i];
                      const style = cellStyle(activeMetric.id, val, precip);
                      const showRainMark =
                        (activeMetric.id.startsWith('cloud_') || activeMetric.id === 'clear_score') && precip != null && precip >= 0.1;
                      return (
                        <td
                          key={i}
                          className="hm-cell"
                          style={style}
                          title={`${MODEL_LABEL[m]} ${formatHM(new Date(fc.time[i]))}: ${activeMetric.shortLabel} ${
                            val == null ? '—' : val.toFixed(activeMetric.digits)
                          }${activeMetric.unit}`}
                        >
                          {val == null ? '—' : val.toFixed(activeMetric.digits)}
                          {showRainMark ? '☂' : ''}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* 全項目を一度に並べて見る展開テーブル */}
          <div className="all-metrics-bar">
            <button type="button" className="btn" onClick={() => setShowAllMetrics((v) => !v)}>
              {showAllMetrics ? '▲ 全項目一覧表を閉じる' : '▼ 全13項目をまとめて一覧表示'}
            </button>
            {showAllMetrics && (
              <div className="seg-group">
                {MODELS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={summaryModel === m ? 'seg active' : 'seg'}
                    onClick={() => setSummaryModel(m)}
                  >
                    {MODEL_LABEL[m]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {showAllMetrics && (
            <table className="heatmap-table" style={{ marginTop: 8 }}>
              {renderTimeHeader(`${MODEL_LABEL[summaryModel]} 全項目 / 時刻`)}
              <tbody>
                {METRICS.map((met) => (
                  <tr
                    key={met.id}
                    className={met.id === metricId ? 'selected-row' : ''}
                    onClick={() => setMetricId(met.id)}
                    style={{ cursor: 'pointer' }}
                    title="クリックで上の4モデル比較表をこの項目に切替"
                  >
                    <td className="model-cell">
                      <b>{met.shortLabel}</b> <span className="sub">({met.unit})</span>
                    </td>
                    {heatIndices.map((i) => {
                      const val = metricValue(fc, met.id, summaryModel, i);
                      const precip = fc.series.precipitation?.[summaryModel]?.[i];
                      const style = cellStyle(met.id, val, precip);
                      return (
                        <td key={i} className="hm-cell" style={style}>
                          {val == null ? '—' : val.toFixed(met.digits)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {fc && mode === 'chart' && <div ref={chartRef} className="echart-box" />}

      <p className="note">
        ※ 予報はモデル格子（MSM約5km・ECMWF約9km・ICON約11km・GFS約13〜25km）の値であり、尾根と谷の局地差までは表せません。MSMの予報期間は約4日間、ガスト・視程は対応モデルのみ表示されます。
      </p>
    </section>
  );
}
