// 從 seat-select-demo.html（現場盤點後的最新 ground-truth）重生 src/map/b1-classification.json。
// demo 是人工盤點的事實來源；本腳本把它回灌成 seats.js 讀取的分類檔。
// 用法：node scripts/build-classification-from-demo.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const DEMO = 'public/demo/seat-select-demo.html';
const OUT = 'src/map/b1-classification.json';

const demo = readFileSync(DEMO, 'utf8');
const re = /<g class="seat (cat-[\w-]+)((?: \w+)*)" data-id="([^"]*)" data-cat="([\w-]+)"><circle cx="([-\d.]+)" cy="([-\d.]+)"/g;

const seats = [];
for (const m of demo.matchAll(re)) {
  const [, , extra, id, cat, cx, cy] = m;
  seats.push({
    key: seats.length,
    id,
    x: +cx,
    y: +cy,
    cat,
    ...(extra.includes('verified') ? { verified: true } : {}),
  });
}
if (!seats.length) throw new Error('demo 裡找不到任何 <g class="seat ..."> 點位，格式可能變了');

const counts = {};
for (const s of seats) counts[s.cat] = (counts[s.cat] || 0) + 1;

const out = {
  meta: { dispW: 2384, dispH: 1684, total: seats.length, generated: 'from-demo' },
  seats,
};
writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log(`已寫入 ${OUT}：${seats.length} 格`, counts);
