import { defineCases } from "./schema";

// 機器(教室側の ESP32。S25 の「機器」と、中継との同期)のテストケース台帳。期待値は、決めた設計
// (外部設計書 14-17。2026-11-25 に、ソフト主導案に合わせて書き直す予定)と、既存の規則(S25 の
// 受信機の規則 ME509・ME514・ME501・MI501、同時の操作 ME902、位置の受け口 IF01 の認証・形・時刻)から
// 書いた。実装を見て期待値を決めない。外部設計書の本文への反映がまだなので、すべて「条件付き」にしてある
// (反映したら、「確定」に直す)。設計書が応答コードまでは決めていない拒否は、「エラーの応答(DB は変わらない)」
// とだけ書く。基準の「いま」は 2026-11-10(火)10:00 JST。
const REFS_SYNC = ["外部設計書 14-17(同期)", "09 IF01(認証・形・時刻)"];
const REFS_ADMIN = [
  "外部設計書 14-17(S25 の機器)",
  "S25 受信機(ME509・ME514・ME501・MI501)",
];

export const DEVICE_CASES = defineCases([
  {
    id: "T-DEV-001",
    title:
      "鍵が違う・ID が違う・ヘッダーなしは 401(どちらが違うかは分からない)。環境が未設定なら 403。何も保存しない",
    refs: [...REFS_SYNC, "12 章(セキュリティ)"],
    priority: "高",
    kind: "結合",
    precondition: "ゲートウェイの鍵と ID が設定されている。機器の行は 0 件",
    input:
      "正しい本文を、違う鍵・違う X-Gateway-ID・認証のヘッダーなしで送る。鍵を未設定にして、正しい認証で送る",
    expected:
      "前の 3 つは 401 と unauthorized(同じ答え)。未設定は 403 と gateway_disabled。機器の行は 0 件のまま",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-002",
    title: "初めて届いた機器は、未登録として保存される。対応表には出ない",
    refs: REFS_SYNC,
    priority: "高",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input: "機器 2 台(MAC と届いた時刻)を送る",
    expected:
      "200 と { success: true, registered: [] }。機器の行は 2 件で、受信機は結びついていない(未登録)。時刻は、送った時刻のとおり",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-003",
    title:
      "登録済みの機器の対応表(MAC と受信機ID)が返る。未登録は含まれない。同じ教室の複数台は、同じ受信機ID を持てる",
    refs: [...REFS_SYNC, "R7-3(複数の受信機)"],
    priority: "高",
    kind: "結合",
    precondition: "受信機「304」に 2 台、受信機「305」に 1 台、未登録が 1 台",
    input: "機器なしの本文を送る",
    expected:
      "200。registered は、登録済みの 3 台の「MAC=受信機ID」(MAC の順)。未登録の 1 台は含まれない",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-004",
    title:
      "時刻は戻らない。新しい時刻で更新し、遅れて届いた古い時刻では更新しない。同じ回に同じ機器が複数あれば、新しいほう",
    refs: REFS_SYNC,
    priority: "高",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input:
      "機器の時刻を 60 秒前 → 20 秒前 → 50 秒前の順に送る。別の機器を 1 回に 40・5・30 秒前の 3 つ送る",
    expected:
      "1 台目は、20 秒前のまま(50 秒前では更新しない)。2 台目は、5 秒前。機器の行は 2 件",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-005",
    title:
      "サーバーの時刻より 5 分より先の時刻は「いま」にする。5 分ちょうどまでは、そのまま",
    refs: [...REFS_SYNC, "14-12 #8(時刻)"],
    priority: "中",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input: "時刻が、いまから 5 分先の機器と、5 分 1 秒先の機器を送る",
    expected: "5 分先の機器は、その時刻のまま。5 分 1 秒先の機器は、いまの時刻",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-006",
    title: "小文字の MAC は大文字にそろえて保存する。同じ機器は 1 つの行",
    refs: REFS_SYNC,
    priority: "中",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input: "同じ MAC を、小文字と大文字で、別々の回に送る",
    expected: "機器の行は 1 つで、MAC は大文字(02:00:00:00:0A:BC)",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-007",
    title:
      "未登録は 50 件まで。51 件目以降は作らない。すでにある機器の更新と、登録済みの対応表は、影響を受けない",
    refs: [...REFS_SYNC, "14-17(未登録の上限)"],
    priority: "高",
    kind: "結合",
    precondition: "登録済みの機器が 1 台",
    input:
      "未登録の機器 60 台を、1 回で送る。そのあと、作られた 1 台の時刻を更新する",
    expected:
      "未登録の行は 50 件(60 台のうち)。対応表は、登録済みの 1 台のまま。更新は通り、未登録の件数は 50 のまま",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-008",
    title:
      "10 分来ない未登録の行は消える(10 分ちょうどは残り、それより長いと消える)。登録済みは、来なくても消えない",
    refs: [...REFS_SYNC, "14-17(未登録の期限)"],
    priority: "高",
    kind: "結合",
    precondition:
      "未登録が、10 分前ちょうど・10 分と 1 ミリ秒前・60 分前の 3 台。登録済みが、24 時間前に 1 台",
    input: "機器なしの本文を送る",
    expected:
      "残るのは、10 分前ちょうどの未登録と、登録済み。対応表は、登録済みの 1 台",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-009",
    title:
      "一覧に出す時間(10 分)を過ぎた古い時刻の機器は、新しく作らない(10 分前ちょうどは作る)",
    refs: [...REFS_SYNC, "14-17(未登録の期限)"],
    priority: "中",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input: "時刻が、10 分 1 秒前の機器と、10 分前ちょうどの機器を送る",
    expected: "10 分 1 秒前の機器は作らず、10 分前ちょうどの機器は作る",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-010",
    title:
      "MAC の形が違うもの(区切り、長さ、16 進でない文字、全 0、ブロードキャスト、マルチキャスト)が 1 つでもあれば、全体を 400 で断る。何も保存しない",
    refs: [...REFS_SYNC, "14-17(機器の識別)"],
    priority: "高",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input:
      "正しい機器 1 台と、形の違う MAC 1 つ(ハイフン区切り、区切りなし、5 つ、7 つ、16 進でない文字、00:00:00:00:00:00、FF:FF:FF:FF:FF:FF、01:00:00:00:00:01、空)を、順に送る",
    expected:
      "すべて 400 と invalid_request_body。正しい機器も含め、機器の行は 0 件のまま",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-011",
    title:
      "本文の壊れ・形の違い(JSON でない、知らない項目、時刻の形、101 台、Content-Type)は 400。何も保存しない",
    refs: [...REFS_SYNC, "09 IF01(400)"],
    priority: "高",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input:
      "壊れた JSON、知らない項目つき(本文と機器の中)、時刻が「2026-11-10 10:00:00」、機器 101 台、Content-Type が text/plain・なし、配列そのもの",
    expected:
      "壊れた JSON は 400 と invalid_json。ほかは 400 と invalid_request_body。機器の行は 0 件のまま",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-012",
    title:
      "本文の gatewayId が、ヘッダーの X-Gateway-ID と違うときは 400(gateway_id_mismatch)。何も保存しない",
    refs: [...REFS_SYNC, "09 IF01(gateway_id_mismatch)"],
    priority: "中",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input: "gatewayId を、ヘッダーと違う値にして送る(対照: 同じなら 200)",
    expected: "400 と gateway_id_mismatch。機器の行は 0 件のまま",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-013",
    title:
      "16KB まで受ける。16KB を超えれば 413(payload_too_large)。宣言の大きさ(Content-Length)でも、実際の大きさでも。保存しない",
    refs: [...REFS_SYNC, "09 IF01(16KB)"],
    priority: "中",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input:
      "空白を足して、ちょうど 16KB の本文と、16KB と 1 バイトの本文を送る。Content-Length を 16KB と 1 バイトにして送る",
    expected:
      "ちょうど 16KB は 200。16KB 超は、どちらも 413 と payload_too_large。保存しない",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-014",
    title:
      "S25 で受信機を外す、または教室を消すと、その受信機の機器は未登録に戻り、対応表から消える(機器の行は残る)",
    refs: [...REFS_SYNC, "R5-7(教室を消すと受信機も消える)", "S25 受信機"],
    priority: "高",
    kind: "結合",
    precondition:
      "受信機「304」に 1 台、「305」に 1 台、消すための教室の受信機「306」に 1 台",
    input:
      "受信機「304」を消す。教室(受信機「306」の教室)を消す。そのつど同期する",
    expected:
      "対応表は、「305」「306」→「305」だけ。消した受信機の機器の行は残り、未登録になる(行は 3 件のまま)",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-015",
    title: "ログは 1 行で、鍵・Authorization・機器の MAC を出さない",
    refs: [...REFS_SYNC, "14-12 #9(ログ)"],
    priority: "中",
    kind: "結合",
    precondition: "機器の行は 0 件",
    input: "機器 1 台を送る",
    expected:
      "ログは 1 行で、gateway.device-sync を含み、鍵・Authorization・Bearer・機器の MAC を含まない",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-016",
    title:
      "DB につながらなければ 503(database_unavailable)。ほかのエラーは 500。接続先や秘密の値は、答えにも、ログにも出さない",
    refs: [...REFS_SYNC, "09 IF01(503)", "12 章(セキュリティ)"],
    priority: "高",
    kind: "結合",
    precondition: "DB の取り出しが失敗する状態を作る",
    input:
      "DB に届かない(P1001)エラーと、ほかのエラー(接続先を含む文面)で、同期を送る",
    expected:
      "503 と database_unavailable。ほかは 500 と internal_server_error。答えにも、ログにも、接続先や秘密の値が出ない",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-020",
    title:
      "新しい受信機ID で登録する: 200 と MI501。機器は登録済みになり、受信機も S25 に登録される。次の同期の対応表に出る",
    refs: [...REFS_ADMIN, "14-17(登録)"],
    priority: "高",
    kind: "結合",
    precondition: "未登録の機器が 2 台。教室「展示室」に受信機「304」がある",
    input: "未登録の 1 台を、教室「展示室」の受信機ID「306」に結びつける",
    expected:
      "200 と MI501。機器は受信機「306」に結びつく。受信機「306」が、教室「展示室」の受信機として作られる。次の同期の対応表に「MAC=306」が出る",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-021",
    title:
      "その教室にすでにある受信機ID を選ぶと、受信機は増えない。同じ教室の複数台は、同じ受信機ID を持てる",
    refs: [...REFS_ADMIN, "R7-3(複数の受信機)", "14-17(複数台)"],
    priority: "高",
    kind: "結合",
    precondition: "未登録の機器が 2 台。教室「展示室」に受信機「304」がある",
    input: "2 台とも、教室「展示室」の受信機ID「304」に結びつける",
    expected: "どちらも 200。受信機は 1 件のまま。2 台とも「304」に結びつく",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-022",
    title: "受信機ID の前後の空白は取る。64 文字までは登録でき、65 文字は断る",
    refs: [...REFS_ADMIN, "S25 受信機(64 文字)"],
    priority: "中",
    kind: "結合",
    precondition: "未登録の機器が 2 台。受信機は「304」の 1 件",
    input: "「  307 」(前後に空白)と、x を 64 個並べた ID で、それぞれ登録する",
    expected:
      "どちらも 200。「307」と、x を 64 個の受信機ID として結びつく。受信機は 3 件",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-023",
    title:
      "受信機ID が空なら ME501、使えない文字・65 文字なら ME514(400)。機器も受信機も変わらない",
    refs: [...REFS_ADMIN, "ME501・ME514"],
    priority: "高",
    kind: "結合",
    precondition: "未登録の機器が 1 台。受信機は「304」の 1 件",
    input:
      "受信機ID を、空白だけ、「a b」「a/b」「a;b」「é」「あ」「a,b」、x を 65 個にして登録する",
    expected:
      "空は 400 と ME501。ほかはすべて 400 と ME514。機器は未登録のまま、受信機は 1 件のまま",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-024",
    title:
      "ほかの教室の受信機ID は、400 と ME509。機器は変わらず、受信機も増えない",
    refs: [...REFS_ADMIN, "ME509(全教室で重複不可)"],
    priority: "高",
    kind: "結合",
    precondition: "未登録の機器が 1 台。受信機「304」は教室「展示室」のもの",
    input: "その機器を、教室「101」の受信機ID「304」に結びつける",
    expected:
      "400 と ME509。機器は未登録のまま。受信機は 1 件のまま(「101」に「304」は作られない)",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-025",
    title:
      "別の教室の受信機ID に付け替えられる。ほかの機器がない元の受信機は、同じ操作で消える。同じ結びつけの繰り返しは、同じ結果",
    refs: [...REFS_ADMIN, "14-17(付け替え)"],
    priority: "高",
    kind: "結合",
    precondition:
      "機器が、教室「展示室」の受信機「304」に結びついている。教室「101」に受信機「305」がある",
    input:
      "その機器を、教室「101」の受信機ID「305」に結びつける。同じ操作をもう一度する",
    expected:
      "どちらも 200 と MI501。機器は「305」に結びつく。受信機「304」は、使う機器がなくなり、消える。受信機は「305」の 1 件(繰り返しても増えず、消えない)",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-026",
    title:
      "いない機器・UUID でない ID・無効な教室・いない教室は受け付けない(エラーの応答)。機器・受信機は変わらない",
    refs: [...REFS_ADMIN],
    priority: "中",
    kind: "結合",
    precondition:
      "未登録の機器が 1 台。無効にした教室がある。受信機は「304」の 1 件",
    input:
      "いない機器 ID、UUID でない機器 ID、いない教室 ID、無効な教室、UUID でない教室 ID で、受信機ID「308」を結びつける",
    expected:
      "すべて、エラーの応答(400 番台で、500 ではない)。機器は未登録のまま、受信機は 1 件のまま(「308」は作られない)",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-027",
    title:
      "本文の形が違うもの(数字そのもの、オブジェクト、null、項目なし)は受け付けない。何も変わらない",
    refs: [...REFS_ADMIN],
    priority: "中",
    kind: "結合",
    precondition: "未登録の機器が 1 台。受信機は「304」の 1 件",
    input:
      "機器 ID・教室 ID・受信機ID のどれかを、数字、オブジェクト、null、なしにして送る",
    expected:
      "すべて、エラーの応答(400 番台)。機器は未登録のまま、受信機は 1 件のまま",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-028",
    title:
      "先にほかの人が機器を外していたときは、404 と ME902(読み込み直し)。何も作らない",
    refs: [...REFS_ADMIN, "14-13 #4(同時の操作 ME902)"],
    priority: "高",
    kind: "結合",
    precondition: "機器の行を、ほかの操作で消してある。受信機は「304」の 1 件",
    input: "その機器を、受信機ID「310」に結びつける",
    expected: "404 と ME902。受信機「310」は作られない(受信機は 1 件のまま)",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-029",
    title:
      "機器の行を消す(MI501)。使われなくなった受信機も、同じ操作で消える。もう一度外すと 404 と ME902。ほかの機器は変わらない",
    refs: [...REFS_ADMIN, "14-17(外す)"],
    priority: "高",
    kind: "結合",
    precondition: "機器 2 台のうち 1 台が、受信機「304」に結びついている",
    input:
      "結びついている機器を外す。もう一度外す。UUID でない ID、なし、いない ID で外す",
    expected:
      "最初は 200 と MI501(その行が消え、もう 1 台は変わらない。受信機「304」は、ほかに使う機器がなく、消える)。もう一度は 404 と ME902。ほかはエラーの応答(400 番台)",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-032",
    title:
      "付け替えても、ほかの機器がまだ使っている元の受信機は、消えない",
    refs: [...REFS_ADMIN, "14-17(付け替え)"],
    priority: "高",
    kind: "結合",
    precondition: "機器 2 台が、どちらも、教室「展示室」の受信機「304」に結びついている",
    input: "1 台を、教室「101」の受信機ID「305」に付け替える",
    expected:
      "200。付け替えた 1 台は「305」、もう 1 台は「304」のまま。受信機は「304」「305」の 2 件",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-033",
    title:
      "同じ受信機の 2 台のうち 1 台を外しても、受信機は残る。最後の 1 台を外すと消える。結びついていない機器を外しても、機器のない受信機は消えない",
    refs: [...REFS_ADMIN, "14-17(外す)"],
    priority: "高",
    kind: "結合",
    precondition: "機器 2 台が、どちらも、受信機「304」に結びついている",
    input:
      "1 台を外す。もう 1 台を外す。そのあと、未登録の機器を 1 台作り、機器のない受信機「312」がある状態で、その機器を外す",
    expected:
      "1 台目を外しても、受信機「304」は 1 件残り、もう 1 台は「304」のまま。2 台目で、「304」が消える(0 件)。未登録の機器を外しても、機器のない受信機「312」は、そのまま(1 件)",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-030",
    title:
      "外した機器から heartbeat が続けば、次の同期で、また未登録として現れる(対応表には出ない)",
    refs: [...REFS_ADMIN, "14-17(外す)"],
    priority: "中",
    kind: "結合",
    precondition: "機器が、受信機「304」に結びついている",
    input: "その機器を外す。そのあと、その機器の時刻を送る",
    expected: "対応表は空。その MAC の行が、新しい行として、未登録で作られる",
    specStatus: "条件付き",
    review: null,
  },
  {
    id: "T-DEV-031",
    title:
      "同じ新しい受信機ID を、別の教室へ同時に登録すると、成功するのは 1 つだけ。もう 1 つは 400 と ME509。受信機は 1 つ",
    refs: [...REFS_ADMIN, "ME509", "14-13 #4(同時の操作)"],
    priority: "高",
    kind: "結合",
    precondition: "未登録の機器が 2 台",
    input:
      "1 台を教室「展示室」の受信機ID「311」に、もう 1 台を教室「101」の「311」に、同時に結びつける",
    expected:
      "片方は 200、もう片方は 400 と ME509。受信機「311」は 1 件。登録済みの機器は 1 台",
    specStatus: "条件付き",
    review: null,
  },
]);
