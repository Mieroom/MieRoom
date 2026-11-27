import { describe, expect, it } from "vitest";
import {
  FUTURE_TOLERANCE_MS,
  NO_RESPONSE_MS,
  UNREGISTERED_MAX,
  UNREGISTERED_TTL_MS,
  effectiveSeenAt,
  isNoResponse,
  isUnregisteredStale,
  normalizeEspMac,
} from "@/lib/domain/device";
import {
  MAX_SYNC_BYTES,
  MAX_SYNC_DEVICES,
  deviceSyncSchema,
} from "@/lib/domain/device-sync";

// 機器(教室側の ESP32)の規則(外部設計書 14-17)。期待値は、決めた数字(10 分、50 件、5 分)と
// 「形」の定義から、手で決めた。

const NOW = new Date("2026-11-10T01:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("決めた数字", () => {
  it("未登録は 10 分・50 件、応答なしは 5 分、時刻の先送りの許しは 5 分", () => {
    expect(UNREGISTERED_TTL_MS).toBe(10 * 60 * 1000);
    expect(UNREGISTERED_MAX).toBe(50);
    expect(NO_RESPONSE_MS).toBe(5 * 60 * 1000);
    expect(FUTURE_TOLERANCE_MS).toBe(5 * 60 * 1000);
    expect(MAX_SYNC_BYTES).toBe(16 * 1024);
    expect(MAX_SYNC_DEVICES).toBe(100);
  });
});

describe("MAC の形(normalizeEspMac)", () => {
  it("親機が出す形(コロン区切りの 16 進)を、大文字にそろえて返す", () => {
    expect(normalizeEspMac("02:00:00:00:0a:bc")).toBe("02:00:00:00:0A:BC");
    expect(normalizeEspMac("48:9D:31:96:A6:E8")).toBe("48:9D:31:96:A6:E8");
  });

  it("ほかの形は null(区切り・長さ・文字・前後の空白)", () => {
    for (const bad of [
      "",
      "02-00-00-00-00-01",
      "020000000001",
      "02:00:00:00:00",
      "02:00:00:00:00:00:01",
      "0G:00:00:00:00:01",
      " 02:00:00:00:00:01",
      "02:00:00:00:00:01 ",
      "02:00:00:00:00:001",
      "2:0:0:0:0:1",
    ]) {
      expect(normalizeEspMac(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("全部 0、ブロードキャスト、マルチキャスト(先頭の 1 バイトの最下位ビットが 1)は null。単独宛て(先頭が偶数)は通す", () => {
    expect(normalizeEspMac("00:00:00:00:00:00")).toBeNull();
    expect(normalizeEspMac("FF:FF:FF:FF:FF:FF")).toBeNull();
    expect(normalizeEspMac("01:00:00:00:00:01")).toBeNull();
    expect(normalizeEspMac("03:00:00:00:00:01")).toBeNull();
    expect(normalizeEspMac("FD:00:00:00:00:01")).toBeNull();
    expect(normalizeEspMac("00:00:00:00:00:01")).toBe("00:00:00:00:00:01");
    expect(normalizeEspMac("02:00:00:00:00:00")).toBe("02:00:00:00:00:00");
    expect(normalizeEspMac("FE:00:00:00:00:01")).toBe("FE:00:00:00:00:01");
  });
});

describe("時刻の規則", () => {
  it("5 分ちょうどまでの先の時刻は、そのまま。それより先は「いま」", () => {
    const exact = at(FUTURE_TOLERANCE_MS);
    expect(effectiveSeenAt(exact, NOW)).toBe(exact);
    expect(effectiveSeenAt(at(FUTURE_TOLERANCE_MS + 1), NOW)).toBe(NOW);
    const past = at(-1000);
    expect(effectiveSeenAt(past, NOW)).toBe(past);
  });

  it("未登録は、10 分ちょうどまでは一覧に残り、それより長いと古い", () => {
    expect(isUnregisteredStale(at(-UNREGISTERED_TTL_MS), NOW)).toBe(false);
    expect(isUnregisteredStale(at(-UNREGISTERED_TTL_MS - 1), NOW)).toBe(true);
    expect(isUnregisteredStale(NOW, NOW)).toBe(false);
  });

  it("登録済みは、5 分ちょうどまでは応答あり、それより長いと「応答なし」", () => {
    expect(isNoResponse(at(-NO_RESPONSE_MS), NOW)).toBe(false);
    expect(isNoResponse(at(-NO_RESPONSE_MS - 1), NOW)).toBe(true);
    expect(isNoResponse(NOW, NOW)).toBe(false);
  });
});

describe("同期の本文(deviceSyncSchema)", () => {
  const body = (devices: unknown[], extra: Record<string, unknown> = {}) => ({
    gatewayId: "school-pc-001",
    devices,
    ...extra,
  });
  const device = (mac = "02:00:00:00:00:a1") => ({
    senderMac: mac,
    seenAt: "2026-11-10T01:00:00.000Z",
  });

  it("正しい本文を受ける。MAC は大文字にそろう。機器なし・100 台も通る", () => {
    const parsed = deviceSyncSchema.parse(body([device()]));
    expect(parsed.devices[0].senderMac).toBe("02:00:00:00:00:A1");
    expect(deviceSyncSchema.safeParse(body([])).success).toBe(true);
    const hundred = Array.from({ length: 100 }, (_, n) =>
      device(`02:00:00:00:00:${n.toString(16).padStart(2, "0")}`),
    );
    expect(deviceSyncSchema.safeParse(body(hundred)).success).toBe(true);
    expect(
      deviceSyncSchema.safeParse(
        body([...hundred, device("02:00:00:00:01:00")]),
      ).success,
    ).toBe(false);
  });

  it("時刻は、タイムゾーンつきの ISO 形式だけ", () => {
    for (const seenAt of [
      "2026-11-10 10:00:00",
      "2026-11-10T10:00:00",
      "now",
      "",
      1790000000000,
    ]) {
      expect(
        deviceSyncSchema.safeParse(
          body([{ senderMac: "02:00:00:00:00:A1", seenAt }]),
        ).success,
        String(seenAt),
      ).toBe(false);
    }
    expect(
      deviceSyncSchema.safeParse(
        body([
          {
            senderMac: "02:00:00:00:00:A1",
            seenAt: "2026-11-10T10:00:00+09:00",
          },
        ]),
      ).success,
    ).toBe(true);
  });

  it("知らない項目、gatewayId の欠け・長すぎ、形の違う MAC は受けない", () => {
    expect(deviceSyncSchema.safeParse(body([], { extra: 1 })).success).toBe(
      false,
    );
    expect(
      deviceSyncSchema.safeParse(body([{ ...device(), roomId: "304" }]))
        .success,
    ).toBe(false);
    expect(deviceSyncSchema.safeParse({ devices: [] }).success).toBe(false);
    expect(
      deviceSyncSchema.safeParse(body([], { gatewayId: "" })).success,
    ).toBe(false);
    expect(
      deviceSyncSchema.safeParse(body([], { gatewayId: "g".repeat(65) }))
        .success,
    ).toBe(false);
    for (const mac of ["bad", "FF:FF:FF:FF:FF:FF", "x".repeat(18)]) {
      expect(deviceSyncSchema.safeParse(body([device(mac)])).success, mac).toBe(
        false,
      );
    }
    expect(
      deviceSyncSchema.safeParse({ gatewayId: "g", devices: "x" }).success,
    ).toBe(false);
    expect(deviceSyncSchema.safeParse(null).success).toBe(false);
  });
});
