import "server-only";
import {
  UNREGISTERED_MAX,
  UNREGISTERED_TTL_MS,
  effectiveSeenAt,
  isUnregisteredStale,
} from "@/lib/domain/device";
import type { DeviceSync } from "@/lib/domain/device-sync";
import { normalizeReceiverId } from "@/lib/domain/access";
import { MESSAGES } from "@/lib/messages";
import { getDb } from "./db";
import { UUID } from "./reservations";

// 機器 (教室側の ESP32。外部設計書 14-17)。機器には何も書き込まない。どの教室の機器かは、
// この表 (devices) の receiverId で決め、中継は 1 分ごとの device-sync でその対応表をもらう。

const isDuplicate = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code: unknown }).code === "P2002";

// ---- 中継 (device-sync) ---------------------------------------------------------------------

export type DeviceMapping = { senderMac: string; receiverId: string };

/**
 * 中継から届いた機器の最新の時刻を保存して、登録済みの機器の対応表 (espMac → 受信機ID) を返す。
 * 中継は、この表にない機器のイベントを捨てる。
 *
 * - 同じ機器が複数あれば、新しい時刻を使う。時刻は、戻らない (遅れて届いた古い行で、新しい時刻を
 *   上書きしない)。サーバーの時刻より先の時刻は、「いま」にする。
 * - 未登録の機器は、初めて見たときに行を作る。ただし、件数が上限 (50) に達していれば作らない
 *   (偽の MAC で一覧を膨らませない)。10 分来ない未登録の行は、ここで消す (Cron は使わない)。
 */
export async function applyDeviceSync(
  sync: DeviceSync,
  now: Date,
): Promise<{ registered: DeviceMapping[] }> {
  const db = getDb();

  const latest = new Map<string, Date>();
  for (const device of sync.devices) {
    const seenAt = effectiveSeenAt(new Date(device.seenAt), now);
    const known = latest.get(device.senderMac);
    if (known === undefined || seenAt > known) {
      latest.set(device.senderMac, seenAt);
    }
  }

  // 1. 10 分来ない未登録の行を消す。
  await db.device.deleteMany({
    where: {
      receiverId: null,
      lastSeenAt: { lt: new Date(now.getTime() - UNREGISTERED_TTL_MS) },
    },
  });

  // 2. すでにある機器は、時刻が新しいときだけ更新する (1 つの文で、競合しても戻らない)。
  const macs = [...latest.keys()];
  const existing = new Set(
    (
      await db.device.findMany({
        where: { espMac: { in: macs } },
        select: { espMac: true },
      })
    ).map((row) => row.espMac),
  );
  for (const [mac, seenAt] of latest) {
    if (!existing.has(mac)) continue;
    await db.device.updateMany({
      where: { espMac: mac, lastSeenAt: { lt: seenAt } },
      data: { lastSeenAt: seenAt },
    });
  }

  // 3. 新しい機器は、未登録として作る。一覧に出す時間を過ぎた古い行は作らない。件数の上限まで。
  const fresh = [...latest]
    .filter(
      ([mac, seenAt]) =>
        !existing.has(mac) && !isUnregisteredStale(seenAt, now),
    )
    .sort(
      ([macA, a], [macB, b]) =>
        b.getTime() - a.getTime() || macA.localeCompare(macB),
    );
  if (fresh.length > 0) {
    const unregistered = await db.device.count({ where: { receiverId: null } });
    const room = Math.max(0, UNREGISTERED_MAX - unregistered);
    const toCreate = fresh.slice(0, room);
    if (toCreate.length > 0) {
      await db.device.createMany({
        data: toCreate.map(([espMac, lastSeenAt]) => ({ espMac, lastSeenAt })),
        skipDuplicates: true, // 同時に届いても、同じ機器の行は 1 つ
      });
    }
  }

  // 4. 登録済みの機器の対応表。
  const rows = await db.device.findMany({
    where: { receiverId: { not: null } },
    select: { espMac: true, receiver: { select: { receiverId: true } } },
    orderBy: { espMac: "asc" },
  });
  return {
    registered: rows.flatMap((row) =>
      row.receiver === null
        ? []
        : [{ senderMac: row.espMac, receiverId: row.receiver.receiverId }],
    ),
  };
}

// ---- 管理画面 (S25 の「機器」) ----------------------------------------------------------------

export type DeviceResult =
  | { kind: "done"; notice: "MI501" }
  | { kind: "invalid"; message: string }
  | { kind: "not_found" };

/**
 * 機器を、教室の受信機ID に結びつける (登録も、付け替えも、同じ操作)。受信機ID の文字列は、
 * その教室にすでにあればそれを使い、なければ、同じ処理で S25 の受信機にも登録する。ほかの教室の
 * 受信機ID なら、ME509。効くのは、中継が次に対応表を受け取ったとき (最大 1 分)。
 */
export async function assignDevice(
  id: unknown,
  roomId: unknown,
  raw: unknown,
): Promise<DeviceResult> {
  if (typeof id !== "string" || !UUID.test(id)) return { kind: "not_found" };
  if (typeof roomId !== "string" || !UUID.test(roomId)) {
    return { kind: "not_found" };
  }
  if (typeof raw !== "string") return { kind: "not_found" };
  const checked = normalizeReceiverId(raw);
  if (!checked.ok) return { kind: "invalid", message: MESSAGES[checked.code] };

  try {
    return await getDb().$transaction(async (tx): Promise<DeviceResult> => {
      const [device, room, receiver] = await Promise.all([
        tx.device.findUnique({ where: { id }, select: { id: true } }),
        tx.room.findFirst({
          where: { id: roomId, active: true },
          select: { id: true },
        }),
        tx.receiver.findUnique({
          where: { receiverId: checked.value },
          select: { id: true, roomId: true },
        }),
      ]);
      if (device === null || room === null) return { kind: "not_found" };
      if (receiver !== null && receiver.roomId !== roomId) {
        return { kind: "invalid", message: MESSAGES.ME509 };
      }
      const receiverRowId =
        receiver?.id ??
        (
          await tx.receiver.create({
            data: { receiverId: checked.value, roomId },
            select: { id: true },
          })
        ).id;
      const updated = await tx.device.updateMany({
        where: { id },
        data: { receiverId: receiverRowId },
      });
      if (updated.count !== 1) return { kind: "not_found" };
      return { kind: "done", notice: "MI501" };
    });
  } catch (error) {
    // 同時に、同じ受信機ID が別の操作で登録された。
    if (isDuplicate(error)) return { kind: "invalid", message: MESSAGES.ME509 };
    throw error;
  }
}

/** 機器の行を消す。heartbeat が続けば、中継の次の送信で、また未登録として現れる。 */
export async function removeDevice(id: unknown): Promise<DeviceResult> {
  if (typeof id !== "string" || !UUID.test(id)) return { kind: "not_found" };
  const removed = await getDb().device.deleteMany({ where: { id } });
  return removed.count === 1
    ? { kind: "done", notice: "MI501" }
    : { kind: "not_found" };
}
