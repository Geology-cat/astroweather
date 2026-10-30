// 観測地点の KML / KMZ 読み込み・書き出し（Google マイマップ・Google Earth などとの相互運用）。
// KMZ は doc.kml などを収めた ZIP なので fflate で展開・圧縮する。
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { MAX_PLACE_NAME_LENGTH, UNCATEGORIZED, categoryOf, type Category, type Place } from './storage';

// 読み込みの上限。巨大なファイルや、展開すると膨れ上がる ZIP（ZIP 爆弾）でブラウザが固まらないようにする
/** 読み込むファイル（.kml / .kmz）の最大サイズ */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** KMZ から展開する KML の最大サイズ */
export const MAX_KML_BYTES = 50 * 1024 * 1024;
/** 1 ファイルから取り込む地点の最大数 */
export const MAX_POINTS = 2000;

export interface KmlPoint {
  name: string;
  lat: number;
  lon: number;
}

export interface KmlParseResult {
  points: KmlPoint[];
  /** 線・面など、点以外のため取り込めなかったプレースマークの数 */
  skippedNonPoint: number;
  /** ネットワークリンク（外部 KML の参照）だけで地点データを含まない */
  networkLinkOnly: boolean;
}

/** XML 名前空間に関係なく、要素名（ローカル名）で子孫要素を探す */
const byTag = (root: Document | Element, tag: string): Element[] =>
  Array.from(root.querySelectorAll('*')).filter((el) => el.localName === tag);

/** "lon,lat[,alt] lon,lat ..." の最初の座標を取り出す */
function firstCoordinate(text: string): { lat: number; lon: number } | null {
  // 仕様外だが "lon, lat" のようにカンマ後に空白を入れたファイルもあるので詰めてから区切る
  const first = text.trim().replace(/,\s+/g, ',').split(/\s+/)[0];
  if (!first) return null;
  const [lon, lat] = first.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

/** KML 文字列から点のプレースマークを取り出す */
export function parseKml(text: string): KmlParseResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || byTag(doc, 'kml').length === 0) {
    throw new Error('KML ファイルとして読み込めませんでした。');
  }

  const points: KmlPoint[] = [];
  let skippedNonPoint = 0;
  const placemarks = byTag(doc, 'Placemark');
  placemarks.forEach((pm, i) => {
    const point = byTag(pm, 'Point')[0];
    const coordEl = point ? byTag(point, 'coordinates')[0] : undefined;
    const coord = coordEl ? firstCoordinate(coordEl.textContent ?? '') : null;
    if (!coord) {
      skippedNonPoint++;
      return;
    }
    // プレースマーク直下の <name>（フォルダ名などを拾わないよう直下に限る）
    const nameEl = Array.from(pm.children).find((c) => c.localName === 'name');
    const name = (nameEl?.textContent?.trim() || `地点 ${i + 1}`).slice(0, MAX_PLACE_NAME_LENGTH);
    points.push({ name, ...coord });
  });

  if (points.length > MAX_POINTS) {
    throw new Error(`地点が多すぎます（${points.length} 件）。1 ファイルあたり ${MAX_POINTS} 件までにしてください。`);
  }

  return {
    points,
    skippedNonPoint,
    networkLinkOnly: placemarks.length === 0 && byTag(doc, 'NetworkLink').length > 0,
  };
}

/** KMZ（ZIP）から KML 本体を取り出す。doc.kml を優先し、なければ最初の .kml を使う */
export function kmzToKml(data: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (!f.name.toLowerCase().endsWith('.kml')) return false;
        // 展開後のサイズは ZIP の目録に書かれた値で事前に確かめ、大きすぎるものは展開しない
        if (f.originalSize > MAX_KML_BYTES) throw new Error('too large');
        return true;
      },
    });
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message === 'too large'
        ? `KMZ の中の KML が大きすぎます（${MAX_KML_BYTES / 1024 / 1024} MB まで）。`
        : 'KMZ ファイルを展開できませんでした。',
    );
  }
  const names = Object.keys(files);
  const main = names.find((n) => n.toLowerCase() === 'doc.kml') ?? names.sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!main) throw new Error('KMZ の中に KML ファイルが見つかりませんでした。');
  return strFromU8(files[main]);
}

/** ファイル（.kml / .kmz）を読み込んで点を取り出す。拡張子が不明でも ZIP の署名で判別する */
export async function readPlacesFile(file: File): Promise<KmlParseResult> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`ファイルが大きすぎます（${MAX_FILE_BYTES / 1024 / 1024} MB まで）。`);
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
  return parseKml(isZip ? kmzToKml(buf) : strFromU8(buf));
}

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

const placemarkXml = (p: Place, indent: string) => `${indent}<Placemark>
${indent}  <name>${escapeXml(p.name)}</name>
${indent}  <Point>
${indent}    <coordinates>${p.lon},${p.lat},0</coordinates>
${indent}  </Point>
${indent}</Placemark>`;

/**
 * 登録地点を KML 文字列にする。
 * カテゴリを渡すと、カテゴリごとに <Folder> にまとめる（Google Earth などでフォルダとして表示される）。
 */
export function buildKml(places: Place[], categories: Category[] = [], docName = 'AstroWeather 観測地点'): string {
  const body: string[] = [];
  for (const c of categories) {
    const inCat = places.filter((p) => categoryOf(p, categories) === c.id);
    if (!inCat.length) continue;
    body.push(`    <Folder>
      <name>${escapeXml(c.name)}</name>
${inCat.map((p) => placemarkXml(p, '      ')).join('\n')}
    </Folder>`);
  }
  // 未分類の地点はフォルダに入れず、文書の直下に置く
  body.push(...places.filter((p) => categoryOf(p, categories) === UNCATEGORIZED).map((p) => placemarkXml(p, '    ')));
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(docName)}</name>
${body.join('\n')}
  </Document>
</kml>
`;
}

/** 登録地点を KMZ（doc.kml を収めた ZIP）にする */
export function buildKmz(places: Place[], categories: Category[] = []): Uint8Array {
  return zipSync({ 'doc.kml': strToU8(buildKml(places, categories)) });
}

/** 既存の地点と同じ座標（約 1m 以内）か */
export function isSameLocation(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
}

/** ブラウザでファイルとして保存させる */
export function downloadFile(content: string | Uint8Array, filename: string, mime: string) {
  const blob = new Blob([content as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
