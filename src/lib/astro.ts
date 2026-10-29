// 天文計算（太陽・月の出入り／南中、月齢、天文薄明、暗夜区間）。
// astronomy-desktop-widget の仕様（risenThatDay モード・朔望月換算月齢・暗夜区間と理由）に合わせ、
// Astronomy Engine でブラウザ側で計算する。
import * as Astronomy from 'astronomy-engine';
import { DAY_MS, HOUR_MS, type DateKey, addDays, jstMidnight, jstNoon, toDateKey } from './time';

export const SYNODIC_MONTH = 29.530588853;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TransitInfo {
  time: Date;
  /** 南中高度（大気差込み、度） */
  altitude: number;
}

export interface BodyEvents {
  rise: Date | null;
  transit: TransitInfo | null;
  set: Date | null;
}

export interface Twilight {
  /** 朝の天文薄明開始（太陽高度 −18° を上昇通過） */
  dawn: Date | null;
  /** 夕の天文薄明終了（太陽高度 −18° を下降通過） */
  dusk: Date | null;
}

/** 夜の集計窓の種類 */
export type NightKind = 'astronomical' | 'nautical' | 'sunset';

export interface NightWindow {
  start: Date;
  end: Date;
  kind: NightKind;
}

export type BoundaryReason = '薄明終了' | '薄明開始' | '月の入' | '月の出' | '航海薄明終了' | '航海薄明開始' | '日の入' | '日の出';

export interface NightSegment {
  start: Date;
  end: Date;
  /** true = 月が地平線上（月明かり）、false = 暗夜 */
  moonUp: boolean;
  startReason: BoundaryReason;
  endReason: BoundaryReason;
}

export interface MoonInfo {
  /** 0 が新月、0.5 が満月、1 の直前が次の新月（黄経差 / 360） */
  fraction: number;
  /** 月齢（fraction × 朔望月 29.530588853 日） */
  age: number;
  /** 太陽と月の黄経差（0=新月, 180=満月） */
  phaseAngle: number;
  /** 輝面比 0〜1 */
  illumination: number;
}

const observerOf = (p: LatLon) => new Astronomy.Observer(p.lat, p.lon, 0);
const toDate = (t: Astronomy.AstroTime | null): Date | null => (t ? t.date : null);

/** 太陽：対象日（暦日 0:00〜24:00）の日の出・南中・日の入 */
export function sunEvents(p: LatLon, key: DateKey): BodyEvents {
  const obs = observerOf(p);
  const start = jstMidnight(key);
  const rise = toDate(Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, +1, start, 1));
  const set = toDate(Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, -1, start, 1));
  const ha = Astronomy.SearchHourAngle(Astronomy.Body.Sun, obs, 0, start);
  const transit = ha.time.date.getTime() - start.getTime() < DAY_MS ? { time: ha.time.date, altitude: ha.hor.altitude } : null;
  return { rise, transit, set };
}

/**
 * 月（risenThatDay モード）：
 * 対象日（暦日 0:00〜24:00）にのぼった月を追い、その月の南中・月の入を 최대 36 時間先まで探す。
 * 南中・月の入が翌日になる場合は formatTime 側で「翌」が付く。
 * その日に月の出がない場合（正子またぎの 1 日）は、正午以降 24 時間以内の現象をフォールバックとして返す。
 */
export function moonEvents(p: LatLon, key: DateKey): BodyEvents {
  const obs = observerOf(p);
  const dayStart = jstMidnight(key);
  const rise = toDate(Astronomy.SearchRiseSet(Astronomy.Body.Moon, obs, +1, dayStart, 1));
  if (rise) {
    const set = toDate(Astronomy.SearchRiseSet(Astronomy.Body.Moon, obs, -1, rise, 1.5));
    const ha = Astronomy.SearchHourAngle(Astronomy.Body.Moon, obs, 0, rise);
    const limitMs = set ? set.getTime() : rise.getTime() + 36 * HOUR_MS;
    const transit = ha.time.date.getTime() <= limitMs ? { time: ha.time.date, altitude: ha.hor.altitude } : null;
    return { rise, transit, set };
  }
  // 当日に月の出がない日のフォールバック（正午から 24 時間）
  const noon = jstNoon(key);
  const fallbackRise = toDate(Astronomy.SearchRiseSet(Astronomy.Body.Moon, obs, +1, noon, 1));
  const fallbackSet = toDate(Astronomy.SearchRiseSet(Astronomy.Body.Moon, obs, -1, noon, 1));
  const ha = Astronomy.SearchHourAngle(Astronomy.Body.Moon, obs, 0, noon);
  const transit = ha.time.date.getTime() - noon.getTime() < DAY_MS ? { time: ha.time.date, altitude: ha.hor.altitude } : null;
  return { rise: fallbackRise, transit, set: fallbackSet };
}

/** 対象日（暦日）の天文薄明。太陽が −18° に達しない日は null */
export function twilight(p: LatLon, key: DateKey, altitude = -18): Twilight {
  const obs = observerOf(p);
  const start = jstMidnight(key);
  return {
    dawn: toDate(Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, +1, start, 1, altitude)),
    dusk: toDate(Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, -1, start, 1, altitude)),
  };
}

/**
 * 対象日の夜の集計窓：夕の天文薄明終了 〜 翌朝の天文薄明開始。
 * 終夜薄明の夜は航海薄明（−12°）、それもなければ日の入〜日の出で代用する。
 */
export function nightWindow(p: LatLon, key: DateKey): NightWindow | null {
  const obs = observerOf(p);
  // 対象日の正午から探す（夕方→翌朝の順に見つかる）
  const noon = jstNoon(key);
  const tries: { kind: NightKind; alt: number | null }[] = [
    { kind: 'astronomical', alt: -18 },
    { kind: 'nautical', alt: -12 },
    { kind: 'sunset', alt: null },
  ];
  for (const { kind, alt } of tries) {
    const dusk =
      alt === null
        ? Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, -1, noon, 1)
        : Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, -1, noon, 1, alt);
    if (!dusk) continue;
    const dawn =
      alt === null
        ? Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, +1, dusk, 1)
        : Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, +1, dusk, 1, alt);
    if (!dawn) continue;
    return { start: dusk.date, end: dawn.date, kind };
  }
  return null; // 白夜
}

const REASONS: Record<NightKind, { start: BoundaryReason; end: BoundaryReason }> = {
  astronomical: { start: '薄明終了', end: '薄明開始' },
  nautical: { start: '航海薄明終了', end: '航海薄明開始' },
  sunset: { start: '日の入', end: '日の出' },
};

/** その時刻に月が地平線上か（出入りの定義と同じ基準で判定） */
function isMoonUp(obs: Astronomy.Observer, t: Date): boolean {
  const nextRise = Astronomy.SearchRiseSet(Astronomy.Body.Moon, obs, +1, t, 2);
  const nextSet = Astronomy.SearchRiseSet(Astronomy.Body.Moon, obs, -1, t, 2);
  if (!nextSet) return false;
  if (!nextRise) return true;
  return nextSet.date < nextRise.date;
}

/**
 * 夜の集計窓を「暗夜（月が地平線下）」と「月明かり（月が地平線上）」の区間に分割する。
 * 月明かりの強さによる重み付けはしない（事実としての上下のみ）。
 */
export function nightSegments(p: LatLon, win: NightWindow): NightSegment[] {
  const obs = observerOf(p);
  const reasons = REASONS[win.kind];
  const segs: NightSegment[] = [];
  let t = win.start;
  let up = isMoonUp(obs, t);
  let startReason: BoundaryReason = reasons.start;
  for (let guard = 0; guard < 6 && t < win.end; guard++) {
    const limitDays = (win.end.getTime() - t.getTime()) / DAY_MS;
    const next = Astronomy.SearchRiseSet(Astronomy.Body.Moon, obs, up ? -1 : +1, t, limitDays);
    if (!next || next.date >= win.end) {
      segs.push({ start: t, end: win.end, moonUp: up, startReason, endReason: reasons.end });
      break;
    }
    const endReason: BoundaryReason = up ? '月の入' : '月の出';
    segs.push({ start: t, end: next.date, moonUp: up, startReason, endReason });
    t = new Date(next.date.getTime() + 1000); // 同じ現象を再検出しないよう 1 秒進める
    startReason = endReason;
    up = !up;
  }
  return segs;
}

/** 月齢・月相（基準時刻 at の値。astronomy-desktop-widget と同じく黄経差から朔望月換算） */
export function moonInfo(at: Date): MoonInfo {
  const phaseAngle = Astronomy.MoonPhase(at);
  const fraction = ((phaseAngle % 360) + 360) % 360 / 360;
  const age = fraction * SYNODIC_MONTH;
  const illumination = (1 - Math.cos((phaseAngle * Math.PI) / 180)) / 2;
  return { fraction, age, phaseAngle, illumination };
}

/** 天文暦一式（ダッシュボード表示用） */
export interface AstroSummary {
  key: DateKey;
  sun: BodyEvents;
  moon: BodyEvents;
  moonInfo: MoonInfo;
  twilightToday: Twilight;
  twilightTomorrow: Twilight;
  night: NightWindow | null;
  segments: NightSegment[];
  darkMs: number;
}

export function astroSummary(p: LatLon, key: DateKey, now: Date = new Date()): AstroSummary {
  const night = nightWindow(p, key);
  const segments = night ? nightSegments(p, night) : [];
  // 1分未満の誤差断片を除外して合計時間を算出
  const darkMs = segments
    .filter((s) => !s.moonUp && s.end.getTime() - s.start.getTime() >= 60000)
    .reduce((a, s) => a + (s.end.getTime() - s.start.getTime()), 0);
  // 今日を表示しているときは現在時刻、それ以外の日はその日の正午で月齢を計算する（ObservationDay.moonPhaseMoment 準拠）
  const phaseMoment = toDateKey(now) === key ? now : jstNoon(key);
  return {
    key,
    sun: sunEvents(p, key),
    moon: moonEvents(p, key),
    moonInfo: moonInfo(phaseMoment),
    twilightToday: twilight(p, key),
    twilightTomorrow: twilight(p, addDays(key, 1)),
    night,
    segments,
    darkMs,
  };
}
