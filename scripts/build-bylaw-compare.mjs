// 產生「停車場管理辦法修正草案條文對照表」（三欄橫式 A4）→ docs/32-辦法修正草案條文對照表.html
//
// 格式依經理提供之範本（社區規約修正草案條文對照表）：
//   修正條文｜原有條文｜修正說明；異動處「紅字＋底線」——修正條文欄標新增、原有條文欄標刪除；
//   原有條文欄先寫條名再寫內容；增訂條文之原有欄留空、條名寫在修正條文欄。
//
// 條文**不手抄**：從標紅版（docs/19-辦法修訂草案-標紅版.html）抽出各段，
//   <del> → 原有條文欄紅字底線、<ins> → 修正條文欄紅字底線。標紅版改了，重跑即同步。
//   例外（OVERRIDE）見下方，各附理由。
//
// 用法：node scripts/build-bylaw-compare.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'docs/19-辦法修訂草案-標紅版.html'
const OUT = 'docs/32-辦法修正草案條文對照表.html'
const html = readFileSync(SRC, 'utf8')

// 標紅版開頭有「本次修正要點」摘要清單，與條文共用許多字句（如「限承租公益設施機車位」）
// → 錨點一律從條文本體（「壹、依據」起）找，否則會抓到摘要那行、紅字全失。
const BODY = html.indexOf('壹、依據')
if (BODY < 0) throw new Error('標紅版找不到條文本體起點「壹、依據」')

// 以錨點文字找出所在的 <p>…</p>／<li>…</li> 段落（原始 HTML，含 ins/del）
function block(anchor) {
  const i = html.indexOf(anchor, BODY)
  if (i < 0) throw new Error(`標紅版找不到錨點：${anchor}`)
  const start = Math.max(html.lastIndexOf('<p', i), html.lastIndexOf('<li', i))
  const tag = html.slice(start + 1, start + 3) === 'li' ? 'li' : 'p'
  const end = html.indexOf(`</${tag}>`, i)
  return html.slice(html.indexOf('>', start) + 1, end)
}
const clean = (s) => s.replace(/<(?!\/?u\b)[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const oldSide = (b) => clean(b.replace(/<ins>[\s\S]*?<\/ins>/g, '').replace(/<del>([\s\S]*?)<\/del>/g, '<u class="r">$1</u>'))
const newSide = (b) => clean(b.replace(/<del>[\s\S]*?<\/del>/g, '').replace(/<ins>([\s\S]*?)<\/ins>/g, '<u class="r">$1</u>'))

// 列順＝辦法條次。head＝原有條文欄條名；add＝增訂（條名改寫在修正條文欄、原有欄留空）
const ROWS = [
  { head: '參、總則　二、停車位數量', anchors: ['一般（大）機車位', '一般（小）機車位'],
    note: '依 115 年 8 月 19 日現場實勘修正大、小機車位數；機車位總數 655 個不變。' },
  { head: '肆、停車場管理', anchors: ['為機車專用停車位，嚴禁停放其他車種車輛'],
    note: '「雙機車位」明確為相鄰兩格、不限大小；開放重機承租無障礙位，身障者申請時無條件退租。' },
  { head: '肆、停車場管理', anchors: ['機車請放置於機車停車位'],
    note: '增列但書：機車位有餘裕時，得經管委會決議開放部分停放自行車。' },
  { head: '伍、二、機車停車資格', anchors: ['限承租公益設施機車位'],
    note: '明定公益設施機車位保留予社會住宅住戶。' },
  { anchors: ['每戶的第一輛機車'],
    note: '第一輛改採填志願、抽順序號、依序分發。' },
  { anchors: ['每戶第二輛機車停車位使用權'],
    note: '第二輛比照分發，順序號兼作候補序；「承租合約書」正名為「使用承諾書」。' },
  { anchors: ['每戶限登記一次'],
    note: '登記得線上或紙本辦理；證件查驗改於繳費簽約時，行照或身分證擇一。' },
  { anchors: ['（十）車位分配方式'],
    note: '配合（五）（六）修正。' },
  { add: '伍、二、機車停車資格', anchors: ['得向管理中心申請換位'],
    note: '增訂換位規定，每次收作業費 100 元（新收費項目，列入下次區權會追認）。' },
  { head: '伍、三、自行車停車資格', anchors: ['限承租公益設施自行車位'],
    note: '明定公益設施自行車位保留予社會住宅住戶。' },
  { override: 'bike3',
    note: '「使用證明書」依附件二實名正名為「使用承諾書」；增訂逾期未簽視同放棄。' },
  { anchors: ['抽籤順序由每一戶的第一輛開始'],
    note: '補完輪次文字。' },
  { add: '伍、三、自行車停車資格', anchors: ['查核連續三個月無車停放'],
    note: '自行車位免收費，增訂空置三個月收回機制，避免登記占位。' },
  { override: 'bikeMulti',
    note: '依 115 年 9 月 3 日例會第 10 題決議。' },
  { head: '【附件一】標題', override: 'annex1Title',
    note: '與附件二「使用承諾書」用語一致。' },
  { head: '【附件一】機車停車位承租合約書', override: 'annex1Term',
    note: '採曆年制，月日固定、僅留年度空格，免逐份手寫起訖日。' },
  { head: '【附件一】機車停車位承租合約書', override: 'annex1Fee',
    note: '配合肆、五，重機承租相鄰兩個機車位。' },
  { head: '【附件二】自行車停車位使用承諾書　三、', override: 'annex2Misprint',
    note: '更正誤植（「機車」應為「自行車」）。' },
  { head: '【附件二】自行車停車位使用承諾書', override: 'annex2Term',
    note: '比照附件一，月日固定、僅留年度空格。' },
  { head: '【附件二】自行車停車位使用承諾書　表單欄位', override: 'annex2Fields',
    note: '自行車無車牌，「車號」改為「自行車特徵」；增列識別貼紙簽收欄，省一份簽收單。' },
]

// ── 不取自標紅版的列（各附理由）──────────────────────────────────────────
const R = (s) => `<u class="r">${s}</u>`
const OVERRIDE = {
  // 標紅版（及草案第 11 條）把伍三（三）（六）改成「志願分發」，但系統與實施細則
  // 實際對自行車是**隨機抽車位號碼、不排志願**（distribute-bikes.js）——條文與實作不符。
  // 2026-09 已記為「建議 10 月例會改條文而非改系統」→ 本表**不採志願分發**，
  // 維持原文「抽車位號碼」，只保留正名與逾期兩項；伍三（六）因此無須修正，不列。
  bike3: {
    old: '（三）自行車停車位使用權採取登記抽籤制。登記期間為每年 11 月 15 日～11 月 30 日，若登記戶數少於或等於車位數量時，登記住戶抽車位號碼。若登記戶數大於自行車停車位數量，登記截止日後 10 天內舉辦公開抽籤，決定次年停放資格、車位號碼，及未抽中者之候補順序。確定車位號碼後，抽中自行車位之住戶應於公告後 5 日內，至管理中心簽署自行車停車位' + R('使用證明書') + '。如【附件二】。',
    new: '（三）自行車停車位使用權採取登記抽籤制。登記期間為每年 11 月 15 日～11 月 30 日，若登記戶數少於或等於車位數量時，登記住戶抽車位號碼。若登記戶數大於自行車停車位數量，登記截止日後 10 天內舉辦公開抽籤，決定次年停放資格、車位號碼，及未抽中者之候補順序。確定車位號碼後，抽中自行車位之住戶應於公告後 5 日內，至管理中心簽署自行車停車位' + R('使用承諾書') + '。如【附件二】。' + R('未於公告後 10 日內完成簽署程序者，視同放棄，由候補者依序遞補。'),
  },
  // 9/3 例會第 10 題「一位多停」表決通過（經理版紀錄：「一個自行車位不限制只停一輛自行車，
  // 但以不超出停車格為原則」），但標紅版與草案均未收。辦法自行車段本無「一位限停一輛」之限制
  // （伍一（三）係汽車），不入條文亦不牴觸；為使決議有明文依據，列為增訂。
  bikeMulti: {
    add: '伍、三、自行車停車資格',
    old: '',
    new: R('（八）一個自行車停車位不限停放一輛自行車，惟以不超出停車格線為原則。'),
  },
  // ── 附件列：原文取自 docs/05（現行辦法），**不取自標紅版** ──
  // 標紅版的附件依約定「只標新增、不顯示刪除線」（因其為實際使用之表單），
  // 被改掉的原字根本不在檔內——例：附件一·五原文「停放雙機車位」在標紅版中消失，
  // 照抽會讓原有條文欄少字、看起來像沒改。故附件四列一律手寫，對照 docs/05 逐字核過。
  annex1Term: {
    old: '四、本社區機車停車位承租期限：自 ' + R('＿＿＿＿＿ 至 ＿＿＿＿＿') + ' 止。',
    new: '四、本社區機車停車位承租期限：自' + R('民國 ＿＿＿ 年一月一日起至同年十二月三十一日') + '止。',
  },
  annex1Fee: {
    old: '五、承租金額：每一機車停車位每月新臺幣 100 元，本社區機車位足額時，250CC 以上重型機車' + R('停放雙機車位') + '，其承租金額以每月新臺幣 300 元計，每次繳費以到期月份計算，一次繳清租金。',
    new: '五、承租金額：每一機車停車位每月新臺幣 100 元，本社區機車位足額時，250CC 以上重型機車' + R('承租相鄰之兩個機車位') + '，其承租金額以每月新臺幣 300 元計，每次繳費以到期月份計算，一次繳清租金。',
  },
  annex2Misprint: {
    old: '6. ' + R('機車停車位') + '限樂菲莊園社區住戶（或承租戶），為維護社區安全，經查獲為社區之外居民，並提報管委會會議討論後，確認違規者，立即取消停車資格。',
    new: '6. ' + R('自行車停車位') + '限樂菲莊園社區住戶（或承租戶），為維護社區安全，經查獲為社區之外居民，並提報管委會會議討論後，確認違規者，立即取消停車資格。',
  },
  annex2Term: {
    old: '四、本社區自行車停車位使用期限：自 ' + R('＿＿＿＿＿ 至 ＿＿＿＿＿') + ' 止。',
    new: '四、本社區自行車停車位使用期限：自' + R('民國 ＿＿＿ 年一月一日起至同年十二月三十一日') + '止。',
  },
  annex1Title: {
    old: '機車停車位' + R('承租合約書'),
    new: '機車停車位' + R('使用承諾書'),
  },
  annex2Fields: {
    old: '欄位：車位編號、' + R('車號') + '、使用人、聯絡電話、戶號、日期、聯絡地址。',
    new: '欄位：車位編號、' + R('自行車特徵') + '、使用人、聯絡電話、戶號、日期、聯絡地址。<br>' +
      R('※ 自行車無車牌，以戶號及車位編號識別。') + '<br>' + R('□ 已領取識別貼紙 ＿＿ 張'),
  },
}

const rowsHtml = ROWS.map((r) => {
  let oldH, newH, add = r.add
  if (r.override) {
    const o = OVERRIDE[r.override]
    oldH = o.old
    newH = o.new
    add = add || o.add
  } else {
    const bs = r.anchors.map(block)
    oldH = bs.map(oldSide).join('<br>')
    newH = bs.map(newSide).join('<br>')
  }
  const newCell = add ? `<div class="hd r">${add}</div>${newH}` : newH
  const oldCell = add ? '' : (r.head ? `<div class="hd">${r.head}</div>` : '') + oldH
  return `<tr><td>${newCell}</td><td>${oldCell}</td><td class="note">${r.note}</td></tr>`
}).join('\n')

const page = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>樂菲莊園社區地下室停車場管理辦法修正草案條文對照表</title>
<style>
  @page{size:A4 landscape;margin:14mm 13mm}
  *{box-sizing:border-box}
  body{font-family:"PMingLiU","MingLiU","新細明體","Noto Serif TC",serif;color:#000;margin:0;background:#fff;font-size:13px;line-height:1.75}
  .page{max-width:1080px;margin:0 auto;padding:8px 10px}
  h1{font-size:21px;text-align:center;font-weight:normal;margin:0 0 10px;letter-spacing:1px}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  thead{display:table-header-group}
  th{font-weight:normal;letter-spacing:.9em;text-indent:.9em;padding:7px 4px;border:1px solid #555}
  td{border:1px solid #555;padding:6px 9px;vertical-align:top;word-break:break-word}
  tr{break-inside:avoid;page-break-inside:avoid}
  .hd{margin-bottom:2px}
  td.note{font-size:12.5px}
  u.r,.r{color:#d00;text-decoration:underline;text-underline-offset:2px}
</style>
</head>
<body>
<div class="page">
<h1>樂菲莊園社區地下室停車場管理辦法修正草案條文對照表</h1>
<table>
<colgroup><col style="width:40%"><col style="width:40%"><col style="width:20%"></colgroup>
<thead><tr><th>修正條文</th><th>原有條文</th><th>修正說明</th></tr></thead>
<tbody>
${rowsHtml}
</tbody>
</table>
</div>
</body>
</html>
`
writeFileSync(OUT, page)
console.log(`✓ ${OUT}（${ROWS.length} 列）`)
