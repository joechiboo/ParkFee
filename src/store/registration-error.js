// 登記/編輯的「業務錯誤」（可直接顯示給住戶看的訊息，如戶號格式、車號重複）。
// 兩個 backend 共用同一個類別，呼叫端的 instanceof 才會成立。
export class RegistrationError extends Error {}
