import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content Security Policy。GitHub Pages ではレスポンスヘッダーを設定できないため <meta> で指定する。
 * スクリプトは自サイトのものだけを許可し、通信先はこのアプリが実際に使う API・地図タイル・空間データに限定する。
 */
const CSP = [
  "default-src 'self'",
  // 雲量マップのデータ展開に WebAssembly を使うため wasm-unsafe-eval のみ許可（eval 自体は許可しない）
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  [
    'connect-src',
    "'self'",
    'https://api.open-meteo.com', // 予報
    'https://openmeteo.s3.amazonaws.com', // 雲量マップの空間データ
    'https://tile.openstreetmap.org', // 地図タイル
    'https://cyberjapandata.gsi.go.jp', // 地理院タイル
    'https://msearch.gsi.go.jp', // 地名検索（国土地理院）
    'https://nominatim.openstreetmap.org', // 地名検索（OSM）
    'blob:',
    'data:',
  ].join(' '),
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://cyberjapandata.gsi.go.jp",
  // ライブラリ（MapLibre・ECharts）が要素に直接スタイルを付けるため、スタイルだけはインラインを許可する
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** 本番ビルドの index.html にだけ CSP を入れる（開発サーバーはインラインスクリプトを使うため対象外） */
function cspMeta(): Plugin {
  return {
    name: 'astroweather-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }];
    },
  };
}

// GitHub Pages（https://geology-cat.github.io/astroweather/）で配信するため base をリポジトリ名に合わせる
export default defineConfig({
  base: '/astroweather/',
  plugins: [react(), cspMeta()],
  test: {
    environment: 'node',
  },
} as never);
