// 把 seat-select-demo.html（現場校正後的最新點位/車位號/分類/盤點狀態）
// 回灌到 classify.html 的 SEATS 內嵌資料。
// 用法：node scripts/sync-classify-from-demo.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const DEMO = 'public/demo/seat-select-demo.html';
const CLASSIFY = 'public/demo/classify.html';

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
const verified = seats.filter(s => s.verified).length;
console.log(`demo 點位 ${seats.length} 格`, counts, `已盤點 ${verified}`);

const classify = readFileSync(CLASSIFY, 'utf8');
const line = ` const SEATS = ${JSON.stringify(seats)};`;
const updated = classify.replace(/^ const SEATS = \[.*\];$/m, () => line);
if (updated === classify) throw new Error('classify.html 裡找不到 const SEATS 行，沒有寫入');
writeFileSync(CLASSIFY, updated);
console.log(`已寫入 ${CLASSIFY} 的 SEATS（${seats.length} 格，含 cat/verified）`);
console.log('注意：classify 的瀏覽器存檔鍵已換版（v3），開啟後會以同步進來的分類為起點。');
