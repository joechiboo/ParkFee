/**
 * 樂菲莊園 機車車位登記表 — 一鍵生成 Google 表單
 *
 * 用法：
 *   1. 開 https://script.google.com → 新增專案
 *   2. 把本檔全部內容貼進去，存檔
 *   3. 上方函式選 buildParkFeeForm → 執行
 *   4. 第一次會要求授權，點允許
 *   5. 執行完看「執行記錄 / Logs」會印出：
 *        - 編輯表單網址（管委會用）
 *        - 填寫網址（發給住戶）
 *
 * 規格來源：docs/02-Google表單設計.md
 * 設定旋鈕：見下方 CONFIG。
 */

var CONFIG = {
  title: '樂菲莊園 機車車位登記（115 年度）',
  // 戶號驗證：棟(A~H 住戶 / S 店家) + 1~2 位(樓) + "-" + 1~2 位(戶)，大小寫皆可。例：H3-6、S1-2
  householdRegex: '^[A-HSa-hs][0-9]{1,2}-[0-9]{1,2}$',
  householdExample: 'H3-6（店家如 S1-2）',
  maxVehicles: 3,        // 表單做到第幾輛
  collectEmail: false,   // false = 免登入（門檻低、不存信箱）
  collectLicensePhoto: false, // 行照照片上傳：false（不收，守隱私）
};

function buildParkFeeForm() {
  var form = FormApp.create(CONFIG.title);
  form.setDescription(
    '・登記期間：11/15–11/30，逾期未登記以棄權論。\n' +
    '・每戶限登記一次，請一次填齊想登記的所有機車（第 1、2… 輛）。\n' +
    '・本表只做登記，不收任何費用；抽中車位後再到管理中心臨櫃簽約繳費\n' +
    '　（一般 1,200／年、重機 3,600／年）。\n' +
    '・登記時請備妥行車執照（供查驗車號）。本表不蒐集身分證號。'
  );
  form.setProgressBar(true);
  form.setCollectEmail(CONFIG.collectEmail);
  form.setAllowResponseEdits(true); // 允許住戶事後修改；匯入時取最新一筆

  // ===== 區段 1：住戶資料（第一頁）=====
  var household = form.addTextItem()
    .setTitle('戶號')
    .setHelpText('格式範例：' + CONFIG.householdExample + '（棟-樓-戶）')
    .setRequired(true);
  household.setValidation(
    FormApp.createTextValidation()
      .setHelpText('戶號格式不符，請參考範例：' + CONFIG.householdExample)
      .requireTextMatchesPattern(CONFIG.householdRegex)
      .build()
  );

  var phone = form.addTextItem()
    .setTitle('聯絡電話')
    .setRequired(true);
  phone.setValidation(
    FormApp.createTextValidation()
      .setHelpText('請輸入有效電話號碼')
      .requireTextMatchesPattern('^[0-9\\-+() ]{7,}$')
      .build()
  );

  // ===== 各輛機車的區段 =====
  // 兩段式：先建好所有頁面與題目，最後再設跳題（因為跳題要指向後面的頁面）
  var navItems = []; // { item: MultipleChoiceItem, nextPageIndex: n }
  var pageBreaks = [];

  for (var n = 1; n <= CONFIG.maxVehicles; n++) {
    var pb = form.addPageBreakItem().setTitle('第 ' + n + ' 輛機車' + (n === 1 ? '（必填）' : '（選填）'));
    pageBreaks.push(pb);

    form.addTextItem()
      .setTitle('第 ' + n + ' 輛 · 車號')
      .setHelpText('依行照車號填寫，例如 ABC-1234')
      .setRequired(true);

    form.addMultipleChoiceItem()
      .setTitle('第 ' + n + ' 輛 · 車種')
      .setChoiceValues(['一般（250CC 以下）', '重機（250CC 以上，紅／黃牌）'])
      .setRequired(true);

    // 無障礙僅第 1 輛（以「人」為單位優先配給）
    if (n === 1) {
      form.addMultipleChoiceItem()
        .setTitle('是否需要無障礙車位')
        .setHelpText('限行動不便之身心障礙者，優先承租')
        .setChoiceValues(['是', '否'])
        .setRequired(true);
    }

    form.addMultipleChoiceItem()
      .setTitle('第 ' + n + ' 輛 · 是否志願登記小位')
      .setHelpText('志願停一般（小）機車位者免抽籤，依登記順序選位')
      .setChoiceValues(['是', '否'])
      .setRequired(true);

    // 除最後一輛外，頁尾放「還要登記下一輛嗎？」當跳題依據（須為該頁最後一題）
    if (n < CONFIG.maxVehicles) {
      var nav = form.addMultipleChoiceItem()
        .setTitle('還要登記第 ' + (n + 1) + ' 輛嗎？')
        .setRequired(true);
      navItems.push({ item: nav, nextPageIndex: n }); // 指向 pageBreaks[n]（第 n+1 輛）
    }
  }

  // ===== 設定跳題（pass 2）=====
  navItems.forEach(function (nv) {
    var nextPage = pageBreaks[nv.nextPageIndex];
    nv.item.setChoices([
      nv.item.createChoice('要', nextPage),
      nv.item.createChoice('不要', FormApp.PageNavigationType.SUBMIT),
    ]);
  });

  // 行照照片（預設不收）
  if (CONFIG.collectLicensePhoto) {
    form.setCollectEmail(true); // 檔案上傳需登入
    form.addImageItem(); // 佔位提示；實務請改用 addFileUploadItem（需 G Suite/Workspace）
  }

  Logger.log('✅ 表單已建立');
  Logger.log('編輯網址（管委會）：' + form.getEditUrl());
  Logger.log('填寫網址（發住戶）：' + form.getPublishedUrl());
  Logger.log('提示：到表單「回應」分頁 → 連結至試算表，即可匯出 CSV 餵配位工具。');
}
