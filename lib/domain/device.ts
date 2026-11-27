// 機器(教室側の ESP32)の規則 (外部設計書 14-17, S25 の「機器」). No I/O here.
//
// 機器は、親機が出す送信元の MAC (espMac) で見分ける。機器には何も書き込まず、どの教室の機器かは
// Web の表 (devices) で決める。receiverId が null の機器は「未登録」。

/** 未登録の機器の一覧に残す時間。これを過ぎて何も届かない未登録の行は、次の要求のときに消す。 */
export const UNREGISTERED_TTL_MS = 10 * 60 * 1000;
/** 未登録の機器の件数の上限。偽の MAC を大量に送られても、一覧が膨らまない。 */
export const UNREGISTERED_MAX = 50;
/** 登録済みの機器から、これだけ何も届かないと「応答なし」と出す。 */
export const NO_RESPONSE_MS = 5 * 60 * 1000;
/** 時刻がサーバーの時刻よりこれより先なら、「いま」として扱う (位置のイベントと同じ。14-12 #8)。 */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * 機器の MAC: 親機が出す形 ("AA:BB:CC:DD:EE:FF") だけを受け、大文字にそろえる。
 * 送信元として届くはずのない MAC (すべて 0、先頭の 1 バイトの最下位ビットが 1 のもの=
 * ブロードキャストとマルチキャスト) は、機器として扱わない。
 */
export function normalizeEspMac(text: string): string | null {
  if (!/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(text)) return null;
  const mac = text.toUpperCase();
  if (mac === "00:00:00:00:00:00") return null;
  const first = Number.parseInt(mac.slice(0, 2), 16);
  if ((first & 1) === 1) return null;
  return mac;
}

/** 届いた時刻。サーバーの時刻より先の時刻は、「いま」にする (親機・中継の時計のずれ)。 */
export function effectiveSeenAt(seenAt: Date, now: Date): Date {
  return seenAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS ? now : seenAt;
}

/** 未登録の行が、一覧に出す時間を過ぎているか。 */
export function isUnregisteredStale(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() > UNREGISTERED_TTL_MS;
}

/** 登録済みの機器が「応答なし」か (最後に確認してから 5 分より長い)。 */
export function isNoResponse(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() > NO_RESPONSE_MS;
}
