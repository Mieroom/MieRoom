"use strict";
// 提出の範囲に入れないもの(調査用の隠し要素)。件数・一覧・活動の経過に、含めない。
// collect.cjs(件数)と doc07.cjs(活動の経過)が、同じ決まりを使う。
module.exports = {
  /** この名前を含むファイルは、数えない・一覧に出さない */
  HIDDEN_PATH: /mini-game|^app\/\(main\)\/play\//,
  /** この言葉を含むコミットは、数えない・一覧に出さない(件名で判断する) */
  HIDDEN_COMMIT: /ミニゲーム|mini_game|遅刻ダッシュ/,
};
