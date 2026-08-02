#!/usr/bin/env node
// 『永い夢』資料集の健康診断。書き換えたら必ず通す:  node .claude/check.js
// git HEAD との比較で「情報が落ちていないか」を見る。閾値は CLAUDE.md と対応。
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.md') && !f.startsWith('初めて'));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const headRead = f => { try { return cp.execSync('git show HEAD:"' + f + '"', { cwd: ROOT, encoding: 'utf8' }); } catch { return null; } };

// 意図的に落としたものは expected-losses.txt に記録し、欠落チェックから除外する
const ALLOW = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'expected-losses.txt'), 'utf8')
      .split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.split('\t')[0].trim()).filter(Boolean);
  } catch { return []; }
})();
const allowed = s => ALLOW.some(a => s.includes(a) || a.includes(s));

let ng = 0;
const ok = (label, pass, detail) => {
  console.log((pass ? '  OK  ' : '  NG  ') + label + (detail ? '  ' + detail : ''));
  if (!pass) ng++;
};

// 1. リンク:アンカーが全部解決するか(インラインコード内は記法サンプルなので除外)
const strip = /[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu;
const slug = h => h.trim().toLowerCase().replace(strip, '').trim().replace(/ /g, '-');
const anchors = {};
for (const f of files) {
  anchors[f] = new Set(read(f).split(/\r?\n/).filter(l => l.startsWith('#')).map(l => slug(l.replace(/^#+/, ''))));
}
const broken = [];
for (const f of files) {
  for (const m of read(f).replace(/`[^`]*`/g, '').matchAll(/\]\(([^)]+)\)/g)) {
    const t = m[1];
    if (/^https?:/.test(t)) continue;
    const parts = t.split('#'), target = parts[0] || f, anc = parts[1];
    if (!anchors[target]) broken.push(f + ' -> ' + t + ' [FILE]');
    else if (anc && !anchors[target].has(anc)) broken.push(f + ' -> ' + t + ' [ANCHOR]');
  }
}
ok('リンク破損 0', broken.length === 0, broken.join(' / '));

// 2. SSOT:同じ台詞が複数ファイルに存在しないか
const seen = new Map();
for (const f of files) read(f).split(/\r?\n/).forEach(l => {
  if (!l.startsWith('>')) return;
  const k = l.replace(/[\s*>「」『』]/g, '');
  if (k.length < 25) return;
  if (!seen.has(k)) seen.set(k, new Set());
  seen.get(k).add(f);
});
const dup = [...seen].filter(e => e[1].size > 1);
ok('ファイル跨ぎの台詞重複 0', dup.length === 0, dup.map(e => e[0].slice(0, 30) + '(' + [...e[1]].join(',') + ')').join(' / '));

// 3. 装飾:太字が機能しているか(資料の本文1行あたり 0.30 以下)
// 規約が例外と認めている「行頭のフィールドラベル」と「台詞内の強調」は数えない
const heavy = [];
for (const f of files) {
  if (f === 'CLAUDE.md') continue;
  const l = read(f).split(/\r?\n/).filter(x => x.trim() && !x.startsWith('#') && !x.startsWith('>'));
  let n = 0;
  for (const line of l) {
    const body = line.replace(/^(\s*(?:[-|]\s*)?)\*\*[^*]+\*\*(?=\s*[::])/, '$1');
    n += (body.match(/\*\*/g) || []).length / 2;
  }
  const per = n / (l.length || 1);
  if (per > 0.3) heavy.push(f + ':' + per.toFixed(2));
}
ok('太字密度 ≦0.30/行(ラベル除く)', heavy.length === 0, heavy.join(' '));

// 4. 空行率と記法の壊れ
let tot = 0, blank = 0;
for (const f of files) {
  const l = read(f).split(/\r?\n/);
  tot += l.length;
  blank += l.filter(x => !x.trim()).length;
}
ok('空行率 ≦33%', blank / tot <= 0.33, Math.round(blank / tot * 100) + '%');
const stars = files.filter(f => read(f).includes('****'));
ok('**** の二重付与なし', stars.length === 0, stars.join(' '));

// 5. 情報の欠落:git HEAD と比較(CLAUDE.md は資料ではなく手順書なので対象外)
const src = files.filter(f => f !== 'CLAUDE.md');
const now = src.map(read).join('\n');
const before = src.map(f => headRead(f) || '').join('\n');
if (!before.trim()) {
  console.log('  --  git HEAD なし。欠落チェックはスキップ');
} else {
  const lost = (re, label) => {
    const a = new Set(before.match(re) || []), b = new Set(now.match(re) || []);
    const l = [...a].filter(x => !b.has(x) && !allowed(x));
    ok(label, l.length === 0, l.slice(0, 12).join(' '));
  };
  lost(/[ァ-ヴー]{2,}|[A-Z]{3,}/g, '固有名詞の消失 0');
  lost(/\d+(?:\.\d+)?/g, '数値の消失 0');
  const norm = s => new Set(s.split(/\r?\n/).filter(l => l.startsWith('>')).map(l => l.replace(/[\s*>]/g, '')).filter(x => x.length > 20));
  const after = norm(now);
  const ql = [...norm(before)].filter(x => !after.has(x) && !allowed(x));
  ok('台詞(20字超)の消失 0', ql.length === 0, ql.slice(0, 5).map(x => x.slice(0, 40)).join(' / '));
}

console.log(ng === 0 ? '\n全項目パス' : '\n' + ng + ' 項目 NG');
process.exit(ng === 0 ? 0 : 1);
