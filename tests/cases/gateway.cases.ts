import { defineCases } from "./schema";

// 位置の受け取り(IF01。ゲートウェイからの教員位置イベント)のテストケース台帳。期待値は、外部設計書
// (09章 IF01 の表と決まり、規則 R7-1・R7-2)とテスト設計書 4-7 から書いた。実装を見て期待値を決めない。
// 食い違ったら、NG として扱う(仕様が先)。基準の「いま」は 2026-11-10(火)10:00 JST(= 01:00:00 UTC)。
// 設計書に未決の項目(発生時刻がミリ秒まで同じイベントの扱い)は、「条件付き」にした。
const SEED =
  "ゲートウェイの鍵(64 文字)と ID(school-pc-001)が設定済み。講師「田村」(タグ 12)、教室「展示室」(受信機 304)「101」(受信機 305)";

export const GATEWAY_CASES = defineCases([
  {
    id: "T-GW-001",
    title:
      "正しい鍵・ID・新しいイベントは 200。先生の位置が、S05 に教室名で出る",
    refs: ["IF01(返すもの)", "R7-1", "R7-2", "テスト設計書 4-7 T-GW-001"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "正しい Authorization と X-Gateway-ID で、minor 12・roomId 304・status detected のイベント(新しい eventId、30 秒前)を送る",
    expected:
      "200 と { success: true, duplicate: false, currentLocationUpdated: true, eventId }。応答はキャッシュさせない(no-store)。S05 の「田村」に教室「展示室」が出る。位置は、そのイベントの eventId と発生時刻で 1 件保存される",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-002",
    title:
      "同じイベント(eventId)の再送は 200 と duplicate: true(409 にしない)。位置は 1 件のまま",
    refs: ["IF01(同じイベントの再送)", "テスト設計書 4-7 T-GW-002"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input: "同じイベントを 2 回送る",
    expected:
      "2 回目は 200 と { success: true, duplicate: true, eventId }(これだけ)。位置は 1 件のまま、S05 は変わらない",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-003a",
    title: "古いイベントは 200 と older_event。位置は戻らない",
    refs: ["IF01(古いイベント)", "R7-1", "テスト設計書 4-7 T-GW-003"],
    priority: "高",
    kind: "結合",
    precondition: `${SEED}。いまの位置は、教室「101」(10 秒前のイベント)`,
    input: "教室「展示室」の、40 秒前のイベント(別の eventId)を送る",
    expected:
      '200 と { success: true, duplicate: false, currentLocationUpdated: false, reason: "older_event", eventId }。S05 は、教室「101」のまま',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-003b",
    title:
      "発生時刻が、いまの位置と同じ(別のイベント)も older_event。位置は変わらない",
    refs: [
      "IF01(古いイベント: 発生時刻が、いまの位置以前)",
      "IF01 相談中(同じ時刻の扱いは未決)",
    ],
    priority: "中",
    kind: "結合",
    precondition: `${SEED}。いまの位置は、教室「101」(10 秒前のイベント)`,
    input: "教室「展示室」の、同じ発生時刻(10 秒前)の別のイベントを送る",
    expected:
      '200 と currentLocationUpdated: false、reason: "older_event"。S05 は、教室「101」のまま',
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-GW-004a",
    title:
      "登録のない minor は 200 と unknown_teacher(エラーにしない)。位置は作られない。minor は 0〜65535",
    refs: ["IF01(登録のない教員・教室)", "テスト設計書 4-7 T-GW-004"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input: "minor が 999、0、65535(どれも、登録のないタグ)のイベントを送る",
    expected:
      '3 つとも 200 と { success: true, duplicate: false, currentLocationUpdated: false, reason: "unknown_teacher", eventId }。位置は作られない(0 と 65535 は、範囲の内側なので、受け付けられる)',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-004b",
    title:
      "登録のない roomId は 200 と unknown_room(エラーにしない)。いまの位置は変わらない",
    refs: ["IF01(登録のない教員・教室)", "テスト設計書 4-7 T-GW-004"],
    priority: "高",
    kind: "結合",
    precondition: `${SEED}。いまの位置は、教室「101」`,
    input: "roomId が 999(登録のない受信機)の、新しいイベントを送る",
    expected:
      '200 と { success: true, duplicate: false, currentLocationUpdated: false, reason: "unknown_room", eventId }。S05 は、教室「101」のまま',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-005",
    title:
      "鍵が違う・ID が違う・ヘッダーがない・形が違うは 401 と unauthorized。どちらが違うかは分からない。DB は読まない",
    refs: ["IF01(認証)", "IF01(返すもの)", "テスト設計書 4-7 T-GW-005"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "鍵が違う、ID が違う、Authorization がない、X-Gateway-ID がない、両方ない、Basic で送る、Bearer の後ろに余分な文字がある、壊れた本文(認証なし)のそれぞれで送る",
    expected:
      'すべて 401 と { success: false, error: "unauthorized" }(同じ形。鍵の違いと ID の違いで、応答が同じ)。認証に通る前は、DB を読まず、書かない(DB の取り出しが 0 回。位置が 0 件)',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-006",
    title: "鍵か ID が未設定なら、403 と gateway_disabled。DB は読まない",
    refs: ["IF01(認証)", "IF01(返すもの)", "テスト設計書 4-7 T-GW-006"],
    priority: "高",
    kind: "結合",
    precondition: "鍵だけ未設定、ID だけ未設定、両方未設定の 3 つの設定",
    input: "正しい形のイベントと、正しそうなヘッダーで送る",
    expected:
      'どれも 403 と { success: false, error: "gateway_disabled" }。DB は読まず、位置は 0 件',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-007a",
    title: "JSON が壊れていれば 400 と invalid_json",
    refs: ["IF01(返すもの)", "テスト設計書 4-7 T-GW-007"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input: "「{broken」、空の本文、途中で切れた JSON を送る",
    expected: 'すべて 400 と { success: false, error: "invalid_json" }',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-007b",
    title:
      "項目・型が違えば 400 と invalid_request_body。Content-Type が違うときも。保存しない",
    refs: ["IF01(送る中身の表)", "IF01(返すもの)", "テスト設計書 4-7 T-GW-007"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "eventId のないもの・UUID でないもの、eventType が違うもの、minor・roomId・status・occurredAt のないもの、roomId が数字・空・65 文字、status が違うもの、occurredAt が日時でないもの、gatewayId が空・65 文字、本文が配列・null・文字、を送る。Content-Type が text/plain、なし、フォームのものも送る",
    expected:
      'すべて 400 と { success: false, error: "invalid_request_body" }。位置は保存されない(0 件)',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-007c",
    title:
      "ヘッダーと本文の gatewayId が違えば 400 と gateway_id_mismatch。保存しない",
    refs: ["IF01(返すもの)", "テスト設計書 4-7 T-GW-007"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "ヘッダーの X-Gateway-ID は正しく、本文の gatewayId だけが違うイベントを送る",
    expected:
      '400 と { success: false, error: "gateway_id_mismatch" }。位置は保存されない',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-008",
    title:
      "16KB まで受ける。16KB を超えれば 413 と payload_too_large(宣言の大きさでも、実際の大きさでも)。保存しない",
    refs: [
      "IF01(形式: 16KB まで)",
      "IF01(返すもの)",
      "テスト設計書 4-7 T-GW-008",
    ],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "本文がちょうど 16,384 バイトのイベント、16,385 バイトのイベント、Content-Length が 16,385 のイベントを送る",
    expected:
      'ちょうど 16,384 バイトは 200(受ける)。16,385 バイトと、Content-Length の宣言が 16,385 のものは、413 と { success: false, error: "payload_too_large" }。位置は、受けた 1 件だけ',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-009",
    title:
      "発生時刻がサーバーの時刻より 5 分より先なら、受けた時刻で保存する。ちょうど 5 分先は、そのまま",
    refs: ["IF01(決まり: 5 分より先)", "R7-1", "テスト設計書 4-7 T-GW-009"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "発生時刻が、いまから 5 分ちょうど先のイベントを送る。位置を消して、5 分 1 秒先のイベントを送る。続けて、5 秒先の別の教室のイベントを送る",
    expected:
      "5 分ちょうどは、その時刻のまま保存される。5 分 1 秒先は、200 で更新され、保存される発生時刻は「いま」になる。そのあとの、5 秒先のイベントは、位置を更新できる(位置が固定されない)",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-010",
    title:
      "状態: detected と unknown は教室名、offline は「検知エリア外」。教室が null の offline も受ける",
    refs: ["IF01(決まり: 状態の表示)", "R7-2", "テスト設計書 4-7 T-GW-010"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "detected、unknown、offline(教室は展示室)のイベントを、発生時刻の順に送り、そのたびに S05 を読む。続けて、教室「101」で detected を送り、教室が null の offline を送る",
    expected:
      "detected と unknown では、S05 は教室名「展示室」。offline では「検知エリア外」。教室が null の offline も、200 で更新され、S05 は「検知エリア外」",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-011",
    title:
      'minor が文字列 "12" は 400(拒否)。整数でない・範囲外も 400。0 と 65535 は受ける',
    refs: [
      'IF01(送る中身: minor は整数。文字列の "12" は拒否する)',
      "テスト設計書 4-7 T-GW-011",
    ],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      'minor が、文字列の "12"、12.5、-1、65536、true、null のイベントを送る。続けて、minor が 0 と 65535 のイベントを送る',
    expected:
      "前の 6 つは 400 と invalid_request_body(位置は保存されない)。0 と 65535 は、受け付けられる(200)",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-012",
    title:
      "DB につながらなければ 503 と database_unavailable(送り直してよい)。ほかのエラーは 500。中身は返さない",
    refs: [
      "IF01(返すもの)",
      "IF01(エラーも成功も同じ形。鍵、DB、コードの中身は返さない)",
      "テスト設計書 4-7 T-GW-012",
    ],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "DB に届かないエラー(接続の拒否。接続文字列つきのメッセージ)の状態でイベントを送る。続けて、そのほかのエラーの状態で送る",
    expected:
      '最初は 503 と { success: false, error: "database_unavailable" }。次は 500 と { success: false, error: "internal_server_error" }。応答にも、ログにも、接続先・パスワード・鍵が出ない',
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-013",
    title: "ログは、受信ごとに 1 行。鍵・Authorization・教員・教室は出さない",
    refs: ["IF01(決まり: ログ)", "テスト設計書 4-7 T-GW-013"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "正しいイベントを 1 回送る。続けて、鍵が違うイベントを 1 回送る。ログの出力を読む",
    expected:
      "1 回の受信につき 1 行(2 回で 2 行)。1 行目に、eventId、gatewayId、種別、状態、結果、HTTP ステータス、処理時間が出る。鍵、Authorization、教員(minor、名前)、教室(roomId、名前)は、どの行にも出ない",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-GW-014",
    title:
      "同時に届いても、遅れて届いても、位置は新しいほうになる(どちらの順でも)",
    refs: ["IF01(決まり: 保存は 1 つの SQL で行う)", "R7-1"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "新しいイベント(教室「101」、10 秒前)と古いイベント(教室「展示室」、50 秒前)を、同時に送る。順番を入れ替えて、6 回繰り返す(そのたびに位置を消す)",
    expected:
      "毎回、保存される位置は、新しいイベントの eventId と教室「101」(古いイベントが勝つことはない)",
    specStatus: "確定",
    review: null,
  },
]);
