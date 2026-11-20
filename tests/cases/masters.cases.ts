import { defineCases } from "./schema";

// マスタ(クラス・講師・教科・教室。S21)の追加・編集・無効・名前の変更のテストケース台帳。
// 期待値は、外部設計書(規則 R5-1〜R5-4、メッセージ ME501〜ME506・ME515・ME517・ME518・ME706・ME902・
// MI501・MI502・MW501・MW502、画面 S21)とテスト設計書 4-6・11-5 から書いた。実装を見て期待値を決めない。
// 食い違ったら、NG として扱う(仕様が先)。基準の「いま」は 2026-11-10(火)10:00 JST。
// 教室のケースは、画面(master-editor.tsx)が送る形のまま(マスタの種類 kind を、教室の分類 kind が上書きする)。
const SEED =
  "マスタ: クラス「システム専攻1年」(ホームルーム 101)、教室「展示室」(空き)「101」(ホームルーム)、講師「田村」、教科「プログラミング」";

export const MASTER_CASES = defineCases([
  {
    id: "T-MST-001a",
    title: "教室を追加・編集できる",
    refs: ["R5-1", "MI501", "S21", "テスト設計書 4-6 T-MST-001"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "画面と同じ本文で、教室「201」(棟「本館」・空き・備考「自習用」)を追加する。続けて、同じ教室を「202」(ホームルーム・備考なし)に編集する(画面が見た版つき)",
    expected:
      "どちらも 200 と MI501。追加では、教室が DB に入る(棟・分類・備考が、入力のとおり)。編集では、名前・分類が変わり、備考は空になる。名前を変えたので、警告(MW501)の印が付く",
    specStatus: "確定",
    review: null,
    issues: [34],
  },
  {
    id: "T-MST-001b",
    title: "講師を追加・編集できる",
    refs: ["R5-1", "MI501", "S21", "テスト設計書 4-6 T-MST-001"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input: "講師「山田」を追加する。続けて「山田太郎」に編集する",
    expected:
      "どちらも 200 と MI501。追加は、名前の変更なし。編集は、名前が変わり、警告(MW501)の印が付く。DB の名前が「山田太郎」になる",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-001c",
    title: "教科を追加・編集できる",
    refs: ["R5-1", "MI501", "S21", "テスト設計書 4-6 T-MST-001"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input: "教科「数学」を追加する。続けて「数学I」に編集する",
    expected:
      "どちらも 200 と MI501。編集は、名前が変わり、警告(MW501)の印が付く。DB の名前が「数学I」になる",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-001d",
    title: "クラスを追加・編集できる(ホームルーム教室・開始年度・終了年度)",
    refs: ["R5-1", "R5-4", "MI501", "S21", "テスト設計書 4-6 T-MST-001"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "クラス「デザイン専攻1年」(ホームルーム 101、開始 2026、終了 2028)を追加する。続けて、終了年度を空にして編集する",
    expected:
      "どちらも 200 と MI501。DB に、ホームルーム 101・開始 2026・終了 2028・有効で入る。編集後は、終了年度が空(続く)になる。名前は変わらないので、警告の印は付かない",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-002",
    title:
      "名前の重複は断る(無効にしたものを含む)。自分の名前のままの編集はできる",
    refs: ["R5-1", "ME502", "テスト設計書 4-6 T-MST-002"],
    priority: "高",
    kind: "結合",
    precondition:
      SEED +
      "。無効な教科「休止教科」、無効な講師「休止講師」、無効なクラス「休止クラス」もある",
    input:
      "教科「休止教科」「プログラミング」、講師「休止講師」「田村」、クラス「休止クラス」「システム専攻1年」の名前で、それぞれ追加する。続けて、教科「プログラミング」を、自分の名前のままで編集する",
    expected:
      "追加は、すべて 400 と ME502(項目は、教科とクラスが name、講師が displayName)。DB は変わらない。自分の名前のままの編集は 200 で、名前の変更の印は付かない",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-003a",
    title: "クラス名の文字数の境界(30 文字)",
    refs: ["R5-1", "ME504", "6-3", "テスト設計書 4-6 T-MST-003"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input:
      "全角と半角が混じった 30 文字のクラス名と、31 文字のクラス名を、それぞれ追加する",
    expected:
      "30 文字は 200(全角・半角を問わず 1 文字と数える)。31 文字は 400 と ME504(30 文字まで。項目は name)",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-003b",
    title: "講師名の文字数の境界(20 文字)",
    refs: ["R5-1", "ME504", "6-3", "テスト設計書 4-6 T-MST-003"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input: "20 文字の講師名と、21 文字の講師名を、それぞれ追加する",
    expected:
      "20 文字は 200。21 文字は 400 と ME504(20 文字まで。項目は displayName)",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-003c",
    title: "教科名の文字数の境界(30 文字)",
    refs: ["R5-1", "ME504", "6-3", "テスト設計書 4-6 T-MST-003"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input: "30 文字の教科名と、31 文字の教科名を、それぞれ追加する",
    expected: "30 文字は 200。31 文字は 400 と ME504(30 文字まで。項目は name)",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-003e",
    title: "教室の文字数の境界(教室 20、棟・階 20、備考 50)",
    refs: ["R5-1", "ME504", "6-3", "テスト設計書 4-6 T-MST-003"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input:
      "画面と同じ本文で、ちょうどの長さ(教室 20・棟 20・備考 50)の教室と、1 文字ずつ多い教室を、それぞれ追加する",
    expected:
      "ちょうどは 200。1 文字ずつ多いものは 400 で、ME504(教室 20、棟 20、備考 50。項目は name、building、note の順)。DB に入らない",
    specStatus: "確定",
    review: null,
    issues: [34],
  },
  {
    id: "T-MST-004",
    title: "講師「各担当」「外部講師」は登録できない",
    refs: ["R5-1", "ME503", "テスト設計書 4-6 T-MST-004"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input: "講師「各担当」「外部講師」を、それぞれ追加する",
    expected: "どちらも 400 と ME503(項目は displayName)。講師は田村だけのまま",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-005a",
    title: "講師名に「、」は使えない",
    refs: ["R5-1", "ME515", "テスト設計書 4-6 T-MST-005"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input: "講師「山田、佐藤」を追加する",
    expected: "400 と ME515(複数の講師の区切りに使うため。項目は displayName)",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-005b",
    title: "教室名「ー」は使えない(教室未定のしるし)",
    refs: ["R5-1", "R3-9", "ME518", "テスト設計書 4-6 T-MST-005"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input: "画面と同じ本文で、教室名「ー」、教室名「-」を、それぞれ追加する",
    expected: "どちらも 400 と ME518(項目は name)。教室は seed の 2 部屋のまま",
    specStatus: "確定",
    review: null,
    issues: [34],
  },
  {
    id: "T-MST-007",
    title: "クラスの年度の規則(終了 < 開始、桁)",
    refs: ["R5-4", "ME505", "ME517", "テスト設計書 4-6 T-MST-007"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input:
      "開始 2026・終了 2025 のクラス、開始「26」・終了「20x7」のクラスを、それぞれ追加する",
    expected:
      "前者は 400 と ME505(終了は、開始以降。項目は endYear)。後者は 400 と ME517(4 桁の数字。開始・終了の両方)。クラスは seed の 1 つのまま",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-008",
    title: "4 種類とも、無効にして、有効に戻せる",
    refs: ["R5-2", "MI502", "MI502on", "S21", "テスト設計書 4-6 T-MST-008"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "教室・講師・クラス・教科の 4 種類を、それぞれ、無効にする → 有効に戻す(active の入り口)",
    expected:
      "無効にすると 200 と MI502(名前の変更なし)、DB の有効が false。戻すと 200 と MI502on、有効が true",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-008b",
    title: "無効にする入り口は、見つからない・形が違うとき 404。何も変わらない",
    refs: ["R5-2", "ME902", "14-13 #1"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input:
      '存在しない UUID、UUID でない文字列、不明な種類、有効の値が文字列("false")、のそれぞれで無効にする',
    expected: "いずれも 404(ME902 の文言)。展示室は有効のまま",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-009a",
    title: "教室の名前の変更が、今日以降の授業に伝わる。過去は当時の名前のまま",
    refs: ["R5-3", "MW501", "テスト設計書 4-6 T-MST-009"],
    priority: "高",
    kind: "結合",
    precondition:
      SEED + "。展示室の授業が、昨日(11/9)・今日(11/10)・来週(11/16)にある",
    input: "画面と同じ本文で、教室「展示室」を「展示室2」に編集する",
    expected:
      "200。授業の教室名は、昨日は「展示室」のまま、今日と来週は「展示室2」。警告(MW501)の印が付く",
    specStatus: "確定",
    review: null,
    issues: [34],
  },
  {
    id: "T-MST-009b",
    title: "教科の名前の変更が、今日以降の授業に伝わる。過去は当時の名前のまま",
    refs: ["R5-3", "MW501", "テスト設計書 4-6 T-MST-009"],
    priority: "高",
    kind: "結合",
    precondition:
      SEED + "。教科「プログラミング」の授業が、昨日・今日・来週にある",
    input: "教科「プログラミング」を「プログラミングI」に編集する",
    expected:
      "200。授業の教科名は、昨日は「プログラミング」のまま、今日と来週は「プログラミングI」。警告の印が付く",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-009c",
    title: "講師の名前の変更が、今日以降の授業に伝わる。過去は当時の名前のまま",
    refs: ["R5-3", "MW501", "テスト設計書 4-6 T-MST-009"],
    priority: "高",
    kind: "結合",
    precondition: SEED + "。講師「田村」の授業が、昨日と来週にある",
    input: "講師「田村」を「田村太郎」に編集する",
    expected:
      "200。授業の講師名は、昨日は「田村」のまま、来週は「田村太郎」。警告の印が付く",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-009d",
    title:
      "クラスの名前の変更は、授業には写さない(授業はクラスを指す)。警告は出る",
    refs: ["R5-3", "MW501", "14-13 #11", "テスト設計書 4-6 T-MST-009"],
    priority: "中",
    kind: "結合",
    precondition: SEED + "。クラスの授業が、来週にある",
    input: "クラス「システム専攻1年」を「システム専攻1年(改)」に編集する",
    expected:
      "200 と MI501。警告(MW501)の印が付く。授業は 1 件のままで、教科名などの中身は変わらない",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-009e",
    title: "名前を変えない編集では、警告は出ない",
    refs: ["R5-3", "MW501", "テスト設計書 4-6 T-MST-009"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input: "講師「田村」を、同じ名前のまま編集する",
    expected: "200 と MI501。名前の変更の印は付かない",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-010",
    title: "古い版で編集すると、先の変更を守って、断る",
    refs: ["14-13 #4", "ME902", "テスト設計書 4-6 T-MST-010"],
    priority: "高",
    kind: "結合",
    precondition: SEED + "。別の人が先に、同じ教科を編集した(版が更新された)",
    input: "最初の画面が見た古い版のまま、同じ教科を、別の名前に編集する",
    expected: "409 と ME902。先の変更(名前)が残り、後の変更は入らない",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-011",
    title: "必須の欄が空なら断る",
    refs: ["R5-1", "ME501", "テスト設計書 11-5 T-MST-011"],
    priority: "高",
    kind: "結合",
    precondition: SEED,
    input:
      "講師名を空白だけ、教科名を空、クラスの名前・ホームルーム・開始年度を空、にしてそれぞれ追加する",
    expected:
      "いずれも 400 と ME501(項目のすぐ下に出る。クラスは name・homeRoomId・startYear の順)。保存されない",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-012",
    title: "クラスのホームルーム教室に、無効な教室・存在しない教室は選べない",
    refs: ["R5-1", "ME706", "テスト設計書 11-5 T-MST-012"],
    priority: "高",
    kind: "結合",
    precondition: SEED + "。展示室を無効にしている",
    input:
      "ホームルーム教室を、無効な展示室、存在しない教室の ID にして、クラスを追加する",
    expected: "どちらも 400 と ME706(項目は homeRoomId)。保存されない",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-013",
    title:
      "ホームルーム教室を無効にすると、保存はできて、書き出し前の確認の件数が増える",
    refs: ["R5-6", "MW502", "テスト設計書 11-5 T-MST-013"],
    priority: "中",
    kind: "結合",
    precondition: SEED + "。クラスのホームルーム教室は「101」",
    input:
      "何も変えない切り替え(講師を有効にする)で、基準の件数を読む。続けて、教室「101」を無効にする",
    expected:
      "どちらも 200。無効にしたあとの、書き出し前の確認の件数(MW502 の元)が、基準より多い",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-015",
    title:
      "クラスの年度: 開始・終了が同じ年度のクラスは、その年度にだけ存在する。終了なしは続く",
    refs: ["R5-4", "テスト設計書 11-5 T-MST-015"],
    priority: "中",
    kind: "結合",
    precondition: SEED + "。クラス「一年だけ」(開始 2026・終了 2026)を追加済み",
    input: "取り込みの状況の表を、2026 年 11 月と 2027 年 4 月の 2 列で読む",
    expected:
      "「一年だけ」は、2026 年度の列にあり(未取込)、2027 年度の列にはない。「システム専攻1年」(終了なし)は、どちらの列にもある",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-MST-016",
    title: "マスタの種類・ID・本文が違えば、何も保存しない",
    refs: ["14-13 #1", "ME902"],
    priority: "中",
    kind: "結合",
    precondition: SEED,
    input:
      "不明な種類、UUID でない ID、存在しない ID で編集する。本文が JSON でない要求を送る",
    expected:
      "不明な種類・不正な ID・存在しない ID は 404(ME902 の文言)。本文が壊れていれば 400(一般のメッセージ)。教科は seed の 1 件のまま",
    specStatus: "確定",
    review: null,
  },
]);
