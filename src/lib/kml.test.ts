// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { MAX_KML_BYTES, MAX_POINTS, buildKml, buildKmz, isSameLocation, kmzToKml, parseKml } from './kml';
import { MAX_PLACE_NAME_LENGTH } from './storage';

// Google マイマップのエクスポートに近い形（フォルダ・CDATA・線を含む）
const MY_MAPS_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>観測候補地</name>
    <Folder>
      <name>北海道</name>
      <Placemark>
        <name><![CDATA[芦別 & 星の降る里]]></name>
        <description><![CDATA[駐車場あり]]></description>
        <styleUrl>#icon-1899-0288D1</styleUrl>
        <Point>
          <coordinates>
            142.1478,43.4792,0
          </coordinates>
        </Point>
      </Placemark>
      <Placemark>
        <name>支笏湖</name>
        <Point><coordinates>141.33, 42.77</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>遠征ルート</name>
        <LineString><coordinates>141,43,0 142,44,0</coordinates></LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

describe('parseKml', () => {
  it('点のプレースマークだけを名前・座標つきで取り出す', () => {
    const r = parseKml(MY_MAPS_KML);
    expect(r.points).toEqual([
      { name: '芦別 & 星の降る里', lat: 43.4792, lon: 142.1478 },
      { name: '支笏湖', lat: 42.77, lon: 141.33 },
    ]);
    expect(r.skippedNonPoint).toBe(1);
    expect(r.networkLinkOnly).toBe(false);
  });

  it('名前がない地点には連番の名前を付ける', () => {
    const r = parseKml('<kml><Placemark><Point><coordinates>140,40</coordinates></Point></Placemark></kml>');
    expect(r.points).toEqual([{ name: '地点 1', lat: 40, lon: 140 }]);
  });

  it('範囲外の座標は取り込まない', () => {
    const r = parseKml('<kml><Placemark><Point><coordinates>200,95</coordinates></Point></Placemark></kml>');
    expect(r.points).toHaveLength(0);
    expect(r.skippedNonPoint).toBe(1);
  });

  it('ネットワークリンクだけの KML を判別する', () => {
    const r = parseKml(
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><NetworkLink><Link><href>https://example.com/a.kml</href></Link></NetworkLink></Document></kml>',
    );
    expect(r.networkLinkOnly).toBe(true);
  });

  it('KML でない内容はエラーにする', () => {
    expect(() => parseKml('<html><body>not kml</body></html>')).toThrow();
    expect(() => parseKml('this is not xml')).toThrow();
  });
});

describe('KMZ', () => {
  it('doc.kml を優先して取り出す', () => {
    const zip = zipSync({
      'files/other.kml': strToU8('<kml><Document/></kml>'),
      'doc.kml': strToU8(MY_MAPS_KML),
      'images/icon.png': new Uint8Array([1, 2, 3]),
    });
    expect(parseKml(kmzToKml(zip)).points).toHaveLength(2);
  });

  it('KML を含まない ZIP はエラーにする', () => {
    expect(() => kmzToKml(zipSync({ 'a.txt': strToU8('x') }))).toThrow();
  });
});

describe('書き出し', () => {
  const places = [
    { id: 'p1', name: '芦別 <A&B>', lat: 43.4792, lon: 142.1478 },
    { id: 'p2', name: '支笏湖', lat: 42.77, lon: 141.33 },
  ];

  it('書き出した KML を読み戻すと同じ地点になる（名前のエスケープを含む）', () => {
    const r = parseKml(buildKml(places));
    expect(r.points).toEqual(places.map(({ name, lat, lon }) => ({ name, lat, lon })));
  });

  it('書き出した KMZ を読み戻すと同じ地点になる', () => {
    expect(parseKml(kmzToKml(buildKmz(places))).points).toHaveLength(2);
  });
});

describe('isSameLocation', () => {
  it('約 1m 以内なら同じ地点とみなす', () => {
    expect(isSameLocation({ lat: 43.4792, lon: 142.1478 }, { lat: 43.479201, lon: 142.147801 })).toBe(true);
    expect(isSameLocation({ lat: 43.4792, lon: 142.1478 }, { lat: 43.4793, lon: 142.1478 })).toBe(false);
  });
});

describe('読み込みの上限', () => {
  const pm = (name: string) => `<Placemark><name>${name}</name><Point><coordinates>140,40</coordinates></Point></Placemark>`;

  it('長すぎる地点名は切り詰める', () => {
    const r = parseKml(`<kml>${pm('あ'.repeat(500))}</kml>`);
    expect(r.points[0].name).toHaveLength(MAX_PLACE_NAME_LENGTH);
  });

  it('地点が多すぎるファイルはエラーにする', () => {
    expect(() => parseKml(`<kml>${pm('x').repeat(MAX_POINTS + 1)}</kml>`)).toThrow(/多すぎます/);
  });

  it('スクリプトを含む名前も文字列として扱い、実行しない', () => {
    const r = parseKml(`<kml>${pm('<![CDATA[<img src=x onerror="alert(1)">]]>')}</kml>`);
    expect(r.points[0].name).toBe('<img src=x onerror="alert(1)">');
    // 書き出し時はエスケープされる
    expect(buildKml([{ id: 'p1', name: r.points[0].name, lat: 40, lon: 140 }])).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('展開すると巨大になる KMZ（ZIP 爆弾）は展開せずにエラーにする', () => {
    // 同じ文字の繰り返しは極端によく圧縮されるので、小さな KMZ から上限を超える KML ができる
    const huge = new Uint8Array(MAX_KML_BYTES + 1).fill(0x20);
    const kmz = zipSync({ 'doc.kml': huge }, { level: 9 });
    expect(kmz.length).toBeLessThan(1024 * 1024);
    expect(() => kmzToKml(kmz)).toThrow(/大きすぎます/);
  });
});
