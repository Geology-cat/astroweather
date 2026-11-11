// 4 つの数値予報モデルの「次回更新時刻（Open-Meteo で新しい初期値の予報が使えるようになる時刻）」を求める。
// Open-Meteo のモデル別メタデータ（/data/{model}/static/meta.json）の
// 直近の公開時刻 + 更新間隔 から計算し、取得できない場合は既知の運用スケジュールから目安を推定する。

import { useEffect, useState } from 'react';
import { MODELS, type ModelId } from './forecast';
import { HOUR_MS } from './time';

/** Forecast API の models= と、メタデータを持つ単一モデル ID の対応（seamless はアジア域で主に使われる全球モデル） */
export const MODEL_META_DOMAIN: Record<ModelId, string> = {
  jma_msm: 'jma_msm',
  ecmwf_ifs: 'ecmwf_ifs',
  gfs_seamless: 'ncep_gfs013',
  icon_seamless: 'dwd_icon',
};

/** メタデータが取れないときの目安：初期時刻の間隔と、初期時刻から公開までのおおよその遅れ（時間） */
export const FALLBACK_SCHEDULE: Record<ModelId, { intervalH: number; delayH: number }> = {
  jma_msm: { intervalH: 3, delayH: 2.5 },
  ecmwf_ifs: { intervalH: 6, delayH: 7 },
  gfs_seamless: { intervalH: 6, delayH: 4.5 },
  icon_seamless: { intervalH: 6, delayH: 3.5 },
};

export interface ModelRunMeta {
  /** 直近の予報が公開された時刻（UTC ミリ秒） */
  lastAvailableMs: number;
  /** 更新間隔（ミリ秒） */
  intervalMs: number;
}

export interface ModelNextUpdate {
  /** 次回更新の見込み時刻（UTC ミリ秒） */
  nextMs: number;
  /** 見込み時刻を過ぎたが、まだ新しい予報が公開されていない */
  overdue: boolean;
  /** メタデータではなく運用スケジュールから推定した値 */
  estimated: boolean;
}

/** meta.json の生データ（時刻は UNIX 秒）を解釈する。必要な項目がなければ null */
export function parseModelMeta(raw: unknown): ModelRunMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const avail = Number(r.last_run_availability_time);
  const interval = Number(r.update_interval_seconds);
  if (!Number.isFinite(avail) || avail <= 0 || !Number.isFinite(interval) || interval <= 0) return null;
  return { lastAvailableMs: avail * 1000, intervalMs: interval * 1000 };
}

/** メタデータから次回更新時刻を求める */
export function nextFromMeta(meta: ModelRunMeta, nowMs: number): ModelNextUpdate {
  let next = meta.lastAvailableMs + meta.intervalMs;
  // メタデータが古い（何回分も更新が止まって見える）場合は、直近の見込み時刻まで進める
  while (next + meta.intervalMs <= nowMs) next += meta.intervalMs;
  return { nextMs: next, overdue: next <= nowMs, estimated: false };
}

/** 運用スケジュールから次回更新時刻を推定する */
export function nextFromSchedule(model: ModelId, nowMs: number): ModelNextUpdate {
  const { intervalH, delayH } = FALLBACK_SCHEDULE[model];
  const interval = intervalH * HOUR_MS;
  const delay = delayH * HOUR_MS;
  // 公開済みの最新の初期時刻（UTC の 0 時起点で interval ごと）
  const latestInit = Math.floor((nowMs - delay) / interval) * interval;
  return { nextMs: latestInit + interval + delay, overdue: false, estimated: true };
}

const META_ENDPOINT = 'https://api.open-meteo.com/data';
const REFRESH_MS = 10 * 60 * 1000;
const OVERDUE_REFRESH_MS = 2 * 60 * 1000;

async function fetchModelMeta(model: ModelId): Promise<ModelRunMeta | null> {
  try {
    const res = await fetch(`${META_ENDPOINT}/${MODEL_META_DOMAIN[model]}/static/meta.json`);
    if (!res.ok) return null;
    return parseModelMeta(await res.json());
  } catch {
    return null;
  }
}

/**
 * 4 モデルの次回更新時刻。メタデータは 10 分ごと（更新待ちのモデルがある間は 2 分ごと）に取り直す。
 * now は毎分更新される現在時刻を渡す。
 */
export function useModelNextUpdates(now: Date): Record<ModelId, ModelNextUpdate> {
  const nowMs = now.getTime();
  const [metas, setMetas] = useState<Partial<Record<ModelId, ModelRunMeta>>>({});

  const result = {} as Record<ModelId, ModelNextUpdate>;
  for (const m of MODELS) {
    const meta = metas[m];
    result[m] = meta ? nextFromMeta(meta, nowMs) : nextFromSchedule(m, nowMs);
  }

  // 通常は 10 分ごと。見込み時刻を過ぎて更新待ちのモデルがある間は 2 分ごとに取り直す
  const anyOverdue = MODELS.some((m) => result[m].overdue);
  const refreshKey = anyOverdue ? `o${Math.floor(nowMs / OVERDUE_REFRESH_MS)}` : `n${Math.floor(nowMs / REFRESH_MS)}`;

  useEffect(() => {
    let alive = true;
    Promise.all(MODELS.map(async (m) => [m, await fetchModelMeta(m)] as const)).then((list) => {
      if (!alive) return;
      setMetas((prev) => {
        const next = { ...prev };
        for (const [m, meta] of list) if (meta) next[m] = meta;
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return result;
}
