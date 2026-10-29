/* 解説ページ（guide.html）用のスクリプト。CSP でインラインスクリプトを禁止しているため外部ファイルにしている */

/* ===== MathJax v3 + mhchem の設定（tex-chtml.js より先に読み込む） ===== */
window.MathJax = {
  tex: {
    inlineMath: [['\\(', '\\)']],
    displayMath: [['\\[', '\\]']],
    packages: { '[+]': ['mhchem'] },
    tags: 'ams'
  },
  loader: { load: ['[tex]/mhchem'] },
  chtml: { scale: 1.02 }
};

/* ===== 目次の自動生成（h2/h3 → 入れ子リスト） ===== */
document.addEventListener('DOMContentLoaded', function () {
  const content = document.getElementById('content');
  const tocList = document.getElementById('toc-list');
  const headings = content.querySelectorAll('h2, h3');
  let currentOl = tocList, lastLi = null;

  headings.forEach(function (h, i) {
    if (h.closest('section.references')) { /* 参考文献も目次に含める */ }
    if (!h.id) h.id = 'sec-' + (i + 1);
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    if (h.tagName === 'H2') {
      tocList.appendChild(li);
      lastLi = li; currentOl = null;
    } else {
      if (!currentOl) {
        currentOl = document.createElement('ol');
        (lastLi || tocList).appendChild(currentOl);
      }
      currentOl.appendChild(li);
    }
  });
  if (!headings.length) document.getElementById('toc').style.display = 'none';
});
