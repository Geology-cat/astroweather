// 時刻・日付ユーティリティ。アプリ全体を日本時間（Asia/Tokyo, UTC+9 固定・夏時間なし）で扱う。

export const JST_OFFSET_MS = 9 * 3600 * 1000;
export const HOUR_MS = 3600 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** "YYYY-MM-DD"（日本時間の暦日） */
export type DateKey = string;

/** 日本時間の暦日 key の 0:00 を表す Date */
export function jstMidnight(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - JST_OFFSET_MS);
}

/** 日本時間の暦日 key の 12:00 */
export function jstNoon(key: DateKey): Date {
  return new Date(jstMidnight(key).getTime() + 12 * HOUR_MS);
}

/** Date → 日本時間の暦日 key */
export function toDateKey(date: Date): DateKey {
  const j = new Date(date.getTime() + JST_OFFSET_MS);
  const y = j.getUTCFullYear();
  const m = String(j.getUTCMonth() + 1).padStart(2, '0');
  const d = String(j.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(key: DateKey, n: number): DateKey {
  return toDateKey(new Date(jstMidnight(key).getTime() + n * DAY_MS + 12 * HOUR_MS));
}

/**
 * 既定で表示する「夜」の日付。
 * 日本時間 6 時前なら、まだ前日の夜の途中とみなして前日を返す。
 */
export function defaultNightKey(now: Date = new Date()): DateKey {
  const hour = new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();
  return hour < 6 ? toDateKey(new Date(now.getTime() - DAY_MS)) : toDateKey(now);
}

/** 分単位に四捨五入した時刻（日本時間）の [時, 分] と、基準日からの日数差 */
function roundedParts(date: Date, baseKey?: DateKey) {
  const rounded = Math.round(date.getTime() / 60000) * 60000;
  const j = new Date(rounded + JST_OFFSET_MS);
  const dayOffset = baseKey
    ? Math.round((jstMidnight(toDateKey(new Date(rounded))).getTime() - jstMidnight(baseKey).getTime()) / DAY_MS)
    : 0;
  return { h: j.getUTCHours(), m: j.getUTCMinutes(), dayOffset };
}

/** "H:MM"。baseKey を渡すと、翌日以降に「翌」「翌々」、前日に「前」を付ける */
export function formatTime(date: Date | null | undefined, baseKey?: DateKey): string {
  if (!date) return '—';
  const { h, m, dayOffset } = roundedParts(date, baseKey);
  const prefix = dayOffset === 1 ? '翌 ' : dayOffset === 2 ? '翌々 ' : dayOffset === -1 ? '前 ' : '';
  return `${prefix}${h}:${String(m).padStart(2, '0')}`;
}

/** 時刻のみ（接頭辞なし・コンパクト） "H:MM" */
export function formatHM(date: Date): string {
  const { h, m } = roundedParts(date);
  return `${h}:${String(m).padStart(2, '0')}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function weekdayOf(key: DateKey): string {
  return WEEKDAYS[new Date(jstMidnight(key).getTime() + JST_OFFSET_MS).getUTCDay()];
}

/** "2026年10月29日 木曜日" */
export function formatDateLong(key: DateKey): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${y}年${m}月${d}日 ${weekdayOf(key)}曜日`;
}

/** "10月29日 (木)" */
export function formatDateShort(key: DateKey): string {
  const [, m, d] = key.split('-').map(Number);
  return `${m}月${d}日 (${weekdayOf(key)})`;
}

/** "10/29" */
export function formatMD(key: DateKey): string {
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
}

/** "14分" / "3時間 5分" */
export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間 ${m}分`;
}
