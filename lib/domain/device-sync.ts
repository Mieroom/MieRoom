import { z } from "zod";
import { normalizeEspMac } from "./device";

// 中継 (校内 PC) が 1 分ごとに送る「機器の生存通知」の本文 (外部設計書 14-17)。
// POST /api/gateway/device-sync。No I/O here.

/** 本文の大きさの上限 (位置のイベントと同じ)。 */
export const MAX_SYNC_BYTES = 16 * 1024;
/** 1 回に送れる機器の数。 */
export const MAX_SYNC_DEVICES = 100;

const espMac = z
  .string()
  .max(17)
  .transform((value, context) => {
    const mac = normalizeEspMac(value);
    if (mac === null) {
      context.addIssue({ code: "custom", message: "invalid_mac" });
      return z.NEVER;
    }
    return mac;
  });

/**
 * 機器ごとに、直近の 1 件だけを送る。seenAt は、親機の行を受け取った時刻。
 * 同じ機器が 2 回あれば、新しいほうを使う (サーバー側でまとめる)。
 * 数は数、文字は文字として受ける。知らない項目は、受け付けない。
 */
export const deviceSyncSchema = z.strictObject({
  gatewayId: z.string().min(1).max(64),
  devices: z
    .array(
      z.strictObject({
        senderMac: espMac,
        seenAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(MAX_SYNC_DEVICES),
});

export type DeviceSync = z.infer<typeof deviceSyncSchema>;
