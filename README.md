# AstroWeather

天体撮影・観望の判断材料を1画面に集めた、統合天文情報ダッシュボード（Webアプリ）。最終判断はユーザーが行います。

- **公開URL（GitHub Pages）**: https://geology-cat.github.io/astroweather/
- **要件定義**: [要件定義.md](./要件定義.md)
- **解説ページ**: https://geology-cat.github.io/astroweather/guide.html （夜間晴天スコアの算出方法、Open-Meteo と 4 つの数値予報モデルの解説。ソースは `public/guide.html`）

## 主な機能

1. **天文暦ダッシュボード**（[astronomy-desktop-widget](https://github.com/Geology-cat/astronomy-desktop-widget) 準拠）
   - 太陽・月の出入り／南中（高度）、月齢・月相描画
   - 天文薄明（今日・明日）
   - 暗夜（天文薄明終了〜開始のうち月が地平線下にある時間帯）の区間・理由・タイムラインバー
2. **夜間晴天スコア & 複数地点比較**
   - 天文薄明終了〜翌朝の天文薄明開始の「全雲量」と「降水」のみから 0〜100 点で算出（光害・月明かりは混ぜない）
   - 4モデル（JMA MSM / ECMWF IFS / NOAA GFS / DWD ICON）の中央値統合＋モデル別スコアの並列表示
   - 共通時刻軸（17:00〜翌6:00）での時間帯ストリップ比較
3. **地点別の詳細予報**
   - 4モデルの全雲量・上中下層雲量を Clear Outside 風のヒートマップ表で並列表示
   - ECharts による要素別折れ線グラフ（背景に暗夜・月明かり帯を表示）
4. **観測地点マップ & 地点管理**
   - 国土地理院タイル（淡色地図・陰影起伏図・航空写真）／OpenStreetMap 切替
   - 地図クリックで任意地点の登録、北海道観測候補地・全国主要都市プリセット収録
   - KML / KMZ の読み込み・書き出し（Google マイマップ・Google Earth などと地点をやり取りできる）

## ローカル開発

```bash
npm install
npm test
npm run dev
```

## セキュリティ

- 本番ビルドの `index.html` には Content Security Policy（`vite.config.ts`）を `<meta>` で埋め込み、スクリプトは自サイトのもののみ、通信先は使用する API・地図タイル・空間データに限定しています
- 解説ページ（`public/guide.html`）の MathJax は CDN ではなく自サイトから配信します（`npm run dev` / `npm run build` 時に `scripts/copy-vendor.mjs` が `node_modules` から `public/vendor/` へコピー）
- KML / KMZ の読み込みはファイルサイズ・展開後サイズ・地点数・地点名の長さに上限を設けています
- GitHub Actions はアクションをコミット SHA で固定し、権限をジョブごとに最小化、依存パッケージのインストール時スクリプトは実行しません

## クレジット・データ出典

- 気象データ: [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0)
- 地図タイル: [国土地理院（地理院タイル）](https://maps.gsi.go.jp/development/ichiran.html) / © OpenStreetMap contributors
- 天文計算: [Astronomy Engine](https://github.com/cosinekitty/astronomy)

