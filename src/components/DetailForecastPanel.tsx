import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { AstroSummary } from '../lib/astro';
import { MODELS, MODEL_COLOR, MODEL_LABEL, type LocationForecast, type ModelId, type VarName } from '../lib/forecast';
import { HOUR_MS, formatHM, jstNoon } from '../lib/time';

interface Props {
  fc: LocationForecast | null;
  astro: AstroSummary;
  loading: boolean;
  error: string | null;
  placeName: string;
}

type ViewMode = 'heatmap' | 'chart';

type ChartMetric = {
  id: VarName;
  label: string;
  unit: string;
  min?: number;
  max?: number;
};

const METRICS: ChartMetric[] = [
  { id: 'cloud_cover', label: '全雲量', unit: '%', min: 0, max: 100 },
  { id: 'cloud_cover_low', label: '下層雲（〜3km）', unit: '%', min: 0, max: 100 },
  { id: 'cloud_cover_mid', label: '中層雲（3〜8km）', unit: '%', min: 0, max: 100 },
  { id: 'cloud_cover_high', label: '上層雲（8km〜）', unit: '%', min: 0, max: 100 },
  { id: 'precipitation', label: '降水量', unit: 'mm', min: 0 },
  { id: 'wind_speed_10m', label: '風速（10m）', unit: 'm/s', min: 0 },
  { id: 'wind_gusts_10m', label: '最大瞬間風速（MSMなし）', unit: 'm/s', min: 0 },
  { id: 'temperature_2m', label: '気温（2m）', unit: '℃' },
  { id: 'dew_point_2m', label: '露点温度（2m）', unit: '℃' },
  { id: 'relative_humidity_2m', label: '相対湿度', unit: '%', min: 0, max: 100 },
];

const HEATMAP_LAYERS: { id: 'cloud_cover' | 'cloud_cover_low' | 'cloud_cover_mid' | 'cloud_cover_high'; label: string }[] = [
  { id: 'cloud_cover', label: '全雲量' },
  { id: 'cloud_cover_high', label: '上層雲' },
  { id: 'cloud_cover_mid', label: '中層雲' },
  { id: 'cloud_cover_low', label: '下層雲' },
];

/** 雲量（0〜100%）のセル背景色（0%=快晴の青、100%=曇天の灰） */
function cloudCellStyle(val: number | null | undefined, precip: number | null | undefined) {
  if (val == null) {
    return { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)' };
  }
  if (precip != null && precip >= 0.1) {
    return { background: 'rgba(210, 82, 82, 0.55)', color: '#fff' };
  }
  const clear = 1 - Math.max(0, Math.min(100, val)) / 100;
  // clear=1: 澄んだ青、clear=0: 曇りグレー
  const r = Math.round(115 - 65 * clear);
  const g = Math.round(120 + 10 * clear);
  const b = Math.round(130 + 85 * clear);
  const a = 0.28 + 0.52 * clear;
  return { background: `rgba(${r},${g},${b},${a})`, color: '#f3f5f7' };
}

export function DetailForecastPanel({ fc, astro, loading, error, placeName }: Props) {
  const [mode, setMode] = useState<ViewMode>('heatmap');
  const [metricId, setMetricId] = useState<VarName>('cloud_cover');
  const [heatLayer, setHeatLayer] = useState<'cloud_cover' | 'cloud_cover_low' | 'cloud_cover_mid' | 'cloud_cover_high'>('cloud_cover');
  const [rangeMode, setRangeMode] = useState<'night' | 'full'>('night');
  const chartRef = useRef<HTMLDivElement | null>(null);

  const noonMs = jstNoon(astro.key).getTime();
  // 夜間モード：対象日の 15:00 〜 翌 09:00（18 時間）
  const nightStart = noonMs + 3 * HOUR_MS;
  const nightEnd = noonMs + 21 * HOUR_MS;

  useEffect(() => {
    if (mode !== 'chart' || !fc || !chartRef.current) return;
    const inst = echarts.init(chartRef.current);
    const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[0];

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
      type: metric.id === 'precipitation' ? 'bar' : 'line',
      smooth: false,
      showSymbol: rangeMode === 'night',
      symbolSize: 5,
      lineStyle: { width: 2.2, color: MODEL_COLOR[m] },
      itemStyle: { color: MODEL_COLOR[m] },
      data: indices.map((i) => [fc.time[i], fc.series[metric.id]?.[m]?.[i] ?? null]),
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
      grid: { left: 46, right: 18, top: 34, bottom: 32 },
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
        name: `${metric.label} (${metric.unit})`,
        nameTextStyle: { color: '#9ca3af', fontSize: 11 },
        min: metric.min,
        max: metric.max,
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
  }, [mode, fc, metricId, rangeMode, astro, nightStart, nightEnd]);

  // ヒートマップ用インデックス（対象日の 17:00 〜 翌 06:00）
  const heatIndices: number[] = [];
  if (fc) {
    const hs = noonMs + 5 * HOUR_MS;
    const he = noonMs + 18 * HOUR_MS;
    fc.time.forEach((t, i) => {
      if (t >= hs && t <= he) heatIndices.push(i);
    });
  }

  return (
    <section className="card">
      <div className="panel-head">
        <div>
          <h2 className="card-title forecast">📈 地点別の詳細予報 — {placeName}</h2>
          <p className="sub">4モデル（MSM / ECMWF / GFS / ICON）の生データを無加工で並べて表示</p>
        </div>
        <div className="panel-controls">
          <div className="seg-group">
            <button className={mode === 'heatmap' ? 'seg active' : 'seg'} onClick={() => setMode('heatmap')}>
              雲量ヒートマップ表
            </button>
            <button className={mode === 'chart' ? 'seg active' : 'seg'} onClick={() => setMode('chart')}>
              要素別折れ線グラフ
            </button>
          </div>
          {mode === 'heatmap' ? (
            <select className="ctrl-select" value={heatLayer} onChange={(e) => setHeatLayer(e.target.value as typeof heatLayer)}>
              {HEATMAP_LAYERS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}（%）
                </option>
              ))}
            </select>
          ) : (
            <>
              <select className="ctrl-select" value={metricId} onChange={(e) => setMetricId(e.target.value as VarName)}>
                {METRICS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="seg-group">
                <button className={rangeMode === 'night' ? 'seg active' : 'seg'} onClick={() => setRangeMode('night')}>
                  夜間（15時〜翌9時）
                </button>
                <button className={rangeMode === 'full' ? 'seg active' : 'seg'} onClick={() => setRangeMode('full')}>
                  全期間（8日）
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && !fc && <div className="sub">予報を取得中…</div>}

      {fc && mode === 'heatmap' && (
        <div className="heatmap-wrap">
          <table className="heatmap-table">
            <thead>
              <tr>
                <th>モデル / 時刻</th>
                {heatIndices.map((i) => {
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
            <tbody>
              {MODELS.map((m) => {
                const allNull = heatIndices.every((i) => fc.series[heatLayer]?.[m]?.[i] == null);
                return (
                  <tr key={m}>
                    <td className="model-cell">
                      <span className="model-dot" style={{ background: MODEL_COLOR[m] }} />
                      <b>{MODEL_LABEL[m]}</b>
                      {allNull && <span className="sub">（期間外）</span>}
                    </td>
                    {heatIndices.map((i) => {
                      const val = fc.series[heatLayer]?.[m]?.[i];
                      const precip = fc.series.precipitation?.[m]?.[i];
                      const style = cloudCellStyle(val, precip);
                      return (
                        <td
                          key={i}
                          className="hm-cell"
                          style={style}
                          title={`${MODEL_LABEL[m]} ${formatHM(new Date(fc.time[i]))}: 雲量 ${val ?? '—'}%${precip ? ` / 降水 ${precip}mm` : ''}`}
                        >
                          {val == null ? '—' : `${Math.round(val)}`}
                          {precip != null && precip >= 0.1 ? '☂' : ''}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="heatmap-QuickRow">
            { (['wind_speed_10m', 'temperature_2m', 'dew_point_2m', 'relative_humidity_2m'] as const).map((vid) => {
              const labelMap = {
                wind_speed_10m: '風速 m/s (MSM)',
                temperature_2m: '気温 ℃ (MSM)',
                dew_point_2m: '露点 ℃ (MSM)',
                relative_humidity_2m: '湿度 % (MSM)',
              };
              return (
                <div key={vid} className="quick-chip">
                  <span className="sub">{labelMap[vid]}:</span>{' '}
                  {heatIndices
                    .filter((_, idx) => idx % 3 === 0)
                    .map((i) => {
                      const v = fc.series[vid]?.jma_msm?.[i] ?? fc.series[vid]?.ecmwf_ifs?.[i];
                      return `${formatHM(new Date(fc.time[i]))}=${v == null ? '—' : v.toFixed(0)}`;
                    })
                    .join(' / ')}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {fc && mode === 'chart' && <div ref={chartRef} className="echart-box" />}

      <p className="note">
        ※ 予報はモデル格子（MSM約5km・ECMWF約9km・ICON約11km・GFS約13〜25km）の値であり、尾根と谷の局地差までは表せません。MSMの予報期間は約4日間です。
      </p>
    </section>
  );
}
