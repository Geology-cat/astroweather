// 解説ページ（public/guide.html）で使う MathJax を node_modules から public/vendor にコピーする。
// 外部 CDN から読み込むと、CDN が改ざんされた場合にアプリと同じオリジンでスクリプトが動いてしまうため、自サイトから配信する。
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'mathjax');
const dest = join(root, 'public', 'vendor', 'mathjax');

rmSync(dest, { recursive: true, force: true });
for (const rel of ['LICENSE', 'es5/tex-chtml.js', 'es5/input/tex/extensions/mhchem.js', 'es5/output/chtml/fonts/woff-v2']) {
  mkdirSync(dirname(join(dest, rel)), { recursive: true });
  cpSync(join(src, rel), join(dest, rel), { recursive: true });
}
console.log('copied MathJax to public/vendor/mathjax');
