import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MESSAGES } from "@/lib/messages";
import { testDb, closeDatabase, resetDatabase } from "./support/db";
import { ID, USERS, seedBase, type TestRole } from "./support/fixtures";

// 機器の登録・付け替え・外す(S25 の「機器」。T-DEV、外部設計書 14-17): the routes, the server
// functions and a real database. 基準の「いま」は 2026-11-10(火)10:00 JST。本文は、画面が送る形:
//   登録・付け替え: { id(機器の行の ID), roomId(教室の ID), receiverId(受信機ID の文字列) }、
//   外す: { id }。登録と付け替えは、同じ操作(機器を、教室の受信機ID に結びつける)。
// 期待値は、決めた設計(14-17 の 5〜7・30、S25 の受信機の規則 ME509・ME514・ME501・MI501、同時の操作
// ME902)から書いた(tests/cases/devices.cases.ts と同じ内容)。設計書が応答コードまでは決めていない
// 拒否は、「受け付けない(エラーの応答。DB は変わらない)」だけを確かめる。

vi.mock("server-only", () => ({}));
type TestUser = { id: string; name: string; role: TestRole };
const session = vi.hoisted(() => ({ user: null as null | TestUser }));
vi.mock("@/lib/server/session", async () => {
  const { hasRole } = await import("./support/session");
  return {
    getCurrentUser: async () => session.user,
    hasRole,
    hasFreshSession: async () => true,
  };
});
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./support/db");
  return { getDb: () => testDb() };
});

import { POST as deviceAssign } from "@/app/(main)/admin/access/device/route";
import { POST as deviceRemove } from "@/app/(main)/admin/access/device/remove/route";
import { applyDeviceSync } from "@/lib/server/devices";

const HOST = "mieroom.example";
const NOW_MS = Date.parse("2026-11-10T10:00:00+09:00");
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";
const ROOM_OLD = "00000000-0000-4000-8000-000000000141"; // 無効な教室
const DEVICE = {
  a: "00000000-0000-4000-8000-0000000000d1",
  b: "00000000-0000-4000-8000-0000000000d2",
} as const;
const MAC = {
  a: "02:00:00:00:00:A1",
  b: "02:00:00:00:00:B2",
} as const;

function request(path: string, body: unknown) {
  return new NextRequest(`https://${HOST}${path}`, {
    method: "POST",
    headers: {
      host: HOST,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
type Answer = { notice?: string; message?: string };
const answerOf = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Answer,
});

const assign = async (id: unknown, roomId: unknown, receiverId: unknown) =>
  answerOf(
    await deviceAssign(
      request("/admin/access/device", { id, roomId, receiverId }),
    ),
  );
const remove = async (id: unknown) =>
  answerOf(await deviceRemove(request("/admin/access/device/remove", { id })));

const db = () => testDb();
const deviceOf = (id: string) => db().device.findUnique({ where: { id } });
const receiverTextOf = async (id: string) => {
  const device = await db().device.findUniqueOrThrow({
    where: { id },
    include: { receiver: true },
  });
  return device.receiver?.receiverId ?? null;
};
const receiverCount = () => db().receiver.count();
const refused = (result: { status: number }) => {
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(result.status).toBeLessThan(500);
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_MS));
  await resetDatabase();
  await seedBase(); // 教室「展示室」(ID.roomFree)、「101」(ID.roomHome)
  await db().room.create({
    data: { id: ROOM_OLD, name: "旧教室", kind: "FREE", active: false },
  });
  await db().receiver.create({
    data: { receiverId: "304", roomId: ID.roomFree },
  });
  await db().device.createMany({
    data: [
      { id: DEVICE.a, espMac: MAC.a, lastSeenAt: new Date(NOW_MS - 30_000) },
      { id: DEVICE.b, espMac: MAC.b, lastSeenAt: new Date(NOW_MS - 20_000) },
    ],
  });
  session.user = USERS.admin;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDatabase();
});

describe("登録(未登録の機器を、教室の受信機ID に結びつける)", () => {
  it("T-DEV-020 新しい受信機ID で登録する: 200 と MI501。機器は登録済みになり、受信機も S25 に登録される。次の同期の対応表に出る", async () => {
    const result = await assign(DEVICE.a, ID.roomFree, "306");
    expect(result).toEqual({
      status: 200,
      body: { notice: "MI501" },
    });
    expect(await receiverTextOf(DEVICE.a)).toBe("306");
    const receiver = await db().receiver.findUniqueOrThrow({
      where: { receiverId: "306" },
    });
    expect(receiver.roomId).toBe(ID.roomFree); // 教室「展示室」の受信機として登録された
    // 中継が次に受け取る対応表(14-17)
    const table = await applyDeviceSync(
      { gatewayId: "g", devices: [] },
      new Date(NOW_MS),
    );
    expect(table.registered).toEqual([{ senderMac: MAC.a, receiverId: "306" }]);
  });

  it("T-DEV-021 その教室にすでにある受信機ID を選ぶと、受信機は増えない。同じ教室の複数台は、同じ受信機ID を持てる", async () => {
    expect((await assign(DEVICE.a, ID.roomFree, "304")).status).toBe(200);
    expect((await assign(DEVICE.b, ID.roomFree, "304")).status).toBe(200);
    expect(await receiverCount()).toBe(1);
    expect(await receiverTextOf(DEVICE.a)).toBe("304");
    expect(await receiverTextOf(DEVICE.b)).toBe("304");
  });

  it("T-DEV-022 受信機ID の前後の空白は取る。64 文字までは登録でき、65 文字は断る", async () => {
    expect((await assign(DEVICE.a, ID.roomFree, "  307 ")).status).toBe(200);
    expect(await receiverTextOf(DEVICE.a)).toBe("307");
    const longest = "x".repeat(64);
    expect((await assign(DEVICE.b, ID.roomFree, longest)).status).toBe(200);
    expect(await receiverTextOf(DEVICE.b)).toBe(longest);
    expect(await receiverCount()).toBe(3); // 304、307、64 文字
  });

  it("T-DEV-023 受信機ID が空なら ME501、使えない文字・65 文字なら ME514(400)。機器も受信機も変わらない", async () => {
    const before = await receiverCount();
    const empty = await assign(DEVICE.a, ID.roomFree, "   ");
    expect(empty).toEqual({ status: 400, body: { message: MESSAGES.ME501 } });
    for (const text of [
      "a b",
      "a/b",
      "a;b",
      "é",
      "あ",
      "a,b",
      "x".repeat(65),
    ]) {
      const result = await assign(DEVICE.a, ID.roomFree, text);
      expect(result, text).toEqual({
        status: 400,
        body: { message: MESSAGES.ME514 },
      });
    }
    expect((await deviceOf(DEVICE.a))?.receiverId).toBeNull();
    expect(await receiverCount()).toBe(before);
  });

  it("T-DEV-024 ほかの教室の受信機ID は、400 と ME509。機器は変わらず、受信機も増えない", async () => {
    // 「304」は教室「展示室」の受信機。教室「101」には使えない。
    const result = await assign(DEVICE.a, ID.roomHome, "304");
    expect(result).toEqual({ status: 400, body: { message: MESSAGES.ME509 } });
    expect((await deviceOf(DEVICE.a))?.receiverId).toBeNull();
    expect(await receiverCount()).toBe(1);
  });
});

describe("付け替え(登録済みの機器を、別の受信機ID に結びつけ直す)", () => {
  it("T-DEV-025 別の教室の受信機ID に付け替えられる。ほかの機器がない元の受信機は、同じ操作で消える。同じ結びつけの繰り返しは、同じ結果", async () => {
    expect((await assign(DEVICE.a, ID.roomFree, "304")).status).toBe(200);
    const moved = await assign(DEVICE.a, ID.roomHome, "305");
    expect(moved).toEqual({ status: 200, body: { notice: "MI501" } });
    expect(await receiverTextOf(DEVICE.a)).toBe("305");
    expect(
      await db().receiver.findUnique({ where: { receiverId: "304" } }),
    ).toBeNull(); // 使われなくなったので消えた
    // 同じ結びつけをもう一度しても、同じ結果(受信機は消えず、増えない)
    expect((await assign(DEVICE.a, ID.roomHome, "305")).status).toBe(200);
    expect(await receiverTextOf(DEVICE.a)).toBe("305");
    expect(await receiverCount()).toBe(1);
  });

  it("T-DEV-032 付け替えても、ほかの機器がまだ使っている元の受信機は、消えない", async () => {
    expect((await assign(DEVICE.a, ID.roomFree, "304")).status).toBe(200);
    expect((await assign(DEVICE.b, ID.roomFree, "304")).status).toBe(200);
    expect((await assign(DEVICE.a, ID.roomHome, "305")).status).toBe(200);
    expect(await receiverTextOf(DEVICE.a)).toBe("305");
    expect(await receiverTextOf(DEVICE.b)).toBe("304"); // もう 1 台は、そのまま
    expect(await receiverCount()).toBe(2); // 「304」は残り、「305」が増えた
  });
});

describe("見つからない・形の違う本文", () => {
  it("T-DEV-026 いない機器・UUID でない ID・無効な教室・いない教室は受け付けない(エラーの応答)。機器・受信機は変わらない", async () => {
    const before = await receiverCount();
    for (const [id, roomId] of [
      [MISSING_ID, ID.roomFree],
      ["not-a-uuid", ID.roomFree],
      [DEVICE.a, MISSING_ID],
      [DEVICE.a, ROOM_OLD],
      [DEVICE.a, "not-a-uuid"],
    ] as const) {
      const result = await assign(id, roomId, "308");
      refused(result);
    }
    expect((await deviceOf(DEVICE.a))?.receiverId).toBeNull();
    expect(await receiverCount()).toBe(before);
    expect(
      await db().receiver.findUnique({ where: { receiverId: "308" } }),
    ).toBeNull();
  });

  it("T-DEV-027 本文の形が違うもの(数字そのもの、オブジェクト、項目なし)は受け付けない。何も変わらない", async () => {
    const before = await receiverCount();
    const bodies = [
      [123, ID.roomFree, "309"],
      [DEVICE.a, 123, "309"],
      [DEVICE.a, ID.roomFree, 309],
      [DEVICE.a, ID.roomFree, { receiverId: "309" }],
      [DEVICE.a, ID.roomFree, null],
      [undefined, undefined, undefined],
    ] as const;
    for (const [id, roomId, receiverId] of bodies) {
      refused(await assign(id, roomId, receiverId));
    }
    expect((await deviceOf(DEVICE.a))?.receiverId).toBeNull();
    expect(await receiverCount()).toBe(before);
  });

  it("T-DEV-028 先にほかの人が機器を外していたときは、404 と ME902(読み込み直し)。何も作らない", async () => {
    await db().device.delete({ where: { id: DEVICE.a } });
    const before = await receiverCount();
    const result = await assign(DEVICE.a, ID.roomFree, "310");
    expect(result).toEqual({ status: 404, body: { message: MESSAGES.ME902 } });
    expect(await receiverCount()).toBe(before);
  });
});

describe("外す", () => {
  it("T-DEV-029 機器の行を消す(MI501)。使われなくなった受信機も、同じ操作で消える。もう一度外すと 404 と ME902。ほかの機器は変わらない", async () => {
    expect((await assign(DEVICE.a, ID.roomFree, "304")).status).toBe(200);
    const removed = await remove(DEVICE.a);
    expect(removed).toEqual({ status: 200, body: { notice: "MI501" } });
    expect(await deviceOf(DEVICE.a)).toBeNull();
    expect(await deviceOf(DEVICE.b)).not.toBeNull();
    expect(await receiverCount()).toBe(0); // 受信機「304」は、ほかに使う機器がなく、消えた
    const again = await remove(DEVICE.a);
    expect(again).toEqual({ status: 404, body: { message: MESSAGES.ME902 } });
    refused(await remove("not-a-uuid"));
    refused(await remove(undefined));
    refused(await remove(MISSING_ID));
  });

  it("T-DEV-030 外した機器から heartbeat が続けば、次の同期で、また未登録として現れる(登録の対応表には出ない)", async () => {
    expect((await assign(DEVICE.a, ID.roomFree, "304")).status).toBe(200);
    expect((await remove(DEVICE.a)).status).toBe(200);
    const table = await applyDeviceSync(
      {
        gatewayId: "g",
        devices: [{ senderMac: MAC.a, seenAt: new Date(NOW_MS).toISOString() }],
      },
      new Date(NOW_MS),
    );
    expect(table.registered).toEqual([]);
    const back = await db().device.findUniqueOrThrow({
      where: { espMac: MAC.a },
    });
    expect(back.receiverId).toBeNull();
    expect(back.id).not.toBe(DEVICE.a); // 新しい行
  });
});

describe("外す(同じ受信機を、2 台が使っているとき)", () => {
  it("T-DEV-033 同じ受信機の 2 台のうち 1 台を外しても、受信機は残る。最後の 1 台を外すと消える。結びついていない機器を外しても、受信機は消えない", async () => {
    expect((await assign(DEVICE.a, ID.roomFree, "304")).status).toBe(200);
    expect((await assign(DEVICE.b, ID.roomFree, "304")).status).toBe(200);
    expect((await remove(DEVICE.a)).status).toBe(200);
    expect(await receiverCount()).toBe(1); // もう 1 台が使っている
    expect(await receiverTextOf(DEVICE.b)).toBe("304");
    expect((await remove(DEVICE.b)).status).toBe(200);
    expect(await receiverCount()).toBe(0); // 最後の 1 台が外れた

    // 未登録の機器を外しても、受信機(別の機器が使っているもの)は消えない
    await db().device.create({
      data: { id: DEVICE.a, espMac: MAC.a, lastSeenAt: new Date(NOW_MS) },
    });
    await db().receiver.create({
      data: { receiverId: "312", roomId: ID.roomFree },
    });
    expect((await remove(DEVICE.a)).status).toBe(200);
    expect(await receiverCount()).toBe(1); // 機器のない受信機「312」は、そのまま
  });
});

describe("同時の操作", () => {
  it("T-DEV-031 同じ新しい受信機ID を、別の教室へ同時に登録すると、成功するのは 1 つだけ。もう 1 つは 400 と ME509。受信機は 1 つ", async () => {
    const results = await Promise.all([
      assign(DEVICE.a, ID.roomFree, "311"),
      assign(DEVICE.b, ID.roomHome, "311"),
    ]);
    const ok = results.filter((result) => result.status === 200);
    const ng = results.filter((result) => result.status === 400);
    expect(ok).toHaveLength(1);
    expect(ng).toEqual([{ status: 400, body: { message: MESSAGES.ME509 } }]);
    expect(await db().receiver.count({ where: { receiverId: "311" } })).toBe(1);
    const registered = await db().device.count({
      where: { receiverId: { not: null } },
    });
    expect(registered).toBe(1);
  });
});
