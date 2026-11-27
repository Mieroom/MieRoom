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
import { testDb, closeDatabase, resetDatabase } from "./support/db";
import { ID, seedBase } from "./support/fixtures";

// 機器の生存通知(中継との同期。T-DEV、外部設計書 14-17): the route, the real saving code and a real
// database. 基準の「いま」は 2026-11-10(火)10:00 JST。ゲートウェイの鍵と ID は、環境の読み込みを
// 差し替えて決める。DB に届かない状態は、DB の取り出しを差し替えて作る。
// 期待値は、決めた設計(14-17 の 5〜9・28・31、位置の受け口 IF01 と同じ認証・形・時刻の規則)から
// 書いた(tests/cases/devices.cases.ts と同じ内容)。外部設計書の本文への反映はまだなので、台帳では
// 「条件付き」にしてある。

const KEY = "9f".repeat(32);
const GATEWAY = "school-pc-001";
const cfg = vi.hoisted(() => ({ key: "", id: "" }));
const dbControl = vi.hoisted(() => ({ fail: null as null | Error }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/env", () => ({
  getEnv: () => ({
    GATEWAY_API_KEY: cfg.key,
    ALLOWED_GATEWAY_ID: cfg.id,
  }),
}));
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./support/db");
  return {
    getDb: () => {
      if (dbControl.fail !== null) throw dbControl.fail;
      return testDb();
    },
  };
});

import { POST } from "@/app/api/gateway/device-sync/route";

const HOST = "mieroom.example";
const URL = `https://${HOST}/api/gateway/device-sync`;
const NOW_MS = Date.parse("2026-11-10T10:00:00+09:00");
const MINUTE = 60 * 1000;
const iso = (msFromNow: number) => new Date(NOW_MS + msFromNow).toISOString();

/** 試験用の MAC。先頭の 1 バイトが 02 (ローカル管理の単独の宛先) で、正しい機器の MAC。 */
const mac = (n: number) =>
  `02:00:00:00:${Math.floor(n / 256)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase()}:${(n % 256).toString(16).padStart(2, "0").toUpperCase()}`;

const sync = (
  devices: { senderMac: string; seenAt: string }[],
  over: Record<string, unknown> = {},
) => ({ gatewayId: GATEWAY, devices, ...over });

type Sent = {
  status: number;
  body: Record<string, unknown>;
};
async function send(
  body: unknown,
  options: {
    headers?: Record<string, string | null>;
    contentType?: string | null;
  } = {},
): Promise<Sent> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = {
    host: HOST,
    authorization: `Bearer ${KEY}`,
    "x-gateway-id": GATEWAY,
  };
  if (options.contentType !== null) {
    headers["content-type"] = options.contentType ?? "application/json";
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const response = await POST(
    new NextRequest(URL, { method: "POST", headers, body: text }),
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

const db = () => testDb();
const rowOf = (espMac: string) => db().device.findUnique({ where: { espMac } });
const countRows = () => db().device.count();
const registered = (result: Sent) =>
  (result.body.registered as { senderMac: string; receiverId: string }[]).map(
    (row) => `${row.senderMac}=${row.receiverId}`,
  );

let info: ReturnType<typeof vi.spyOn>;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_MS));
  await resetDatabase();
  await seedBase(); // 教室「展示室」「101」
  await db().receiver.createMany({
    data: [
      { receiverId: "304", roomId: ID.roomFree },
      { receiverId: "305", roomId: ID.roomHome },
    ],
  });
  cfg.key = KEY;
  cfg.id = GATEWAY;
  dbControl.fail = null;
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDatabase();
});

describe("認証(位置の受け口と同じ鍵と ID)", () => {
  it("T-DEV-001 鍵が違う・ID が違う・ヘッダーなしは 401(どちらが違うかは分からない)。何も保存しない。環境が未設定なら 403", async () => {
    const body = sync([{ senderMac: mac(1), seenAt: iso(-1000) }]);
    const wrongKey = await send(body, {
      headers: { authorization: `Bearer ${"00".repeat(32)}` },
    });
    const wrongId = await send(body, { headers: { "x-gateway-id": "other" } });
    const noHeaders = await send(body, {
      headers: { authorization: null, "x-gateway-id": null },
    });
    for (const result of [wrongKey, wrongId, noHeaders]) {
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ success: false, error: "unauthorized" });
    }
    expect(wrongKey.body).toEqual(wrongId.body);
    expect(await countRows()).toBe(0);

    cfg.key = "";
    const disabled = await send(body);
    expect(disabled.status).toBe(403);
    expect(disabled.body).toEqual({
      success: false,
      error: "gateway_disabled",
    });
    expect(await countRows()).toBe(0);
  });
});

describe("機器の保存と対応表", () => {
  it("T-DEV-002 初めて届いた機器は、未登録として保存される。対応表には出ない", async () => {
    const result = await send(
      sync([
        { senderMac: mac(1), seenAt: iso(-30 * 1000) },
        { senderMac: mac(2), seenAt: iso(-10 * 1000) },
      ]),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, registered: [] });
    const first = await rowOf(mac(1));
    expect(first?.receiverId).toBeNull();
    expect(first?.lastSeenAt.toISOString()).toBe(iso(-30 * 1000));
    expect((await rowOf(mac(2)))?.lastSeenAt.toISOString()).toBe(
      iso(-10 * 1000),
    );
    expect(await countRows()).toBe(2);
  });

  it("T-DEV-003 登録済みの機器の対応表(機器の MAC と受信機 ID)が返る。未登録は含まれない。複数台は、同じ受信機 ID を持てる", async () => {
    const receiver = await db().receiver.findUniqueOrThrow({
      where: { receiverId: "304" },
    });
    const other = await db().receiver.findUniqueOrThrow({
      where: { receiverId: "305" },
    });
    await db().device.createMany({
      data: [
        {
          espMac: mac(1),
          receiverId: receiver.id,
          lastSeenAt: new Date(NOW_MS),
        },
        {
          espMac: mac(2),
          receiverId: receiver.id,
          lastSeenAt: new Date(NOW_MS),
        },
        { espMac: mac(3), receiverId: other.id, lastSeenAt: new Date(NOW_MS) },
        { espMac: mac(4), lastSeenAt: new Date(NOW_MS) }, // 未登録
      ],
    });
    const result = await send(sync([]));
    expect(result.status).toBe(200);
    expect(registered(result)).toEqual([
      `${mac(1)}=304`,
      `${mac(2)}=304`,
      `${mac(3)}=305`,
    ]);
  });

  it("T-DEV-004 時刻は戻らない: 新しい時刻で更新し、遅れて届いた古い時刻では更新しない。同じ機器が 2 つあれば新しいほう", async () => {
    await send(sync([{ senderMac: mac(1), seenAt: iso(-60 * 1000) }]));
    await send(sync([{ senderMac: mac(1), seenAt: iso(-20 * 1000) }]));
    expect((await rowOf(mac(1)))?.lastSeenAt.toISOString()).toBe(
      iso(-20 * 1000),
    );
    // 遅れて届いた古い時刻
    await send(sync([{ senderMac: mac(1), seenAt: iso(-50 * 1000) }]));
    expect((await rowOf(mac(1)))?.lastSeenAt.toISOString()).toBe(
      iso(-20 * 1000),
    );
    // 同じ回に 2 つ
    await send(
      sync([
        { senderMac: mac(2), seenAt: iso(-40 * 1000) },
        { senderMac: mac(2), seenAt: iso(-5 * 1000) },
        { senderMac: mac(2), seenAt: iso(-30 * 1000) },
      ]),
    );
    expect((await rowOf(mac(2)))?.lastSeenAt.toISOString()).toBe(
      iso(-5 * 1000),
    );
    expect(await countRows()).toBe(2);
  });

  it("T-DEV-005 サーバーの時刻より 5 分より先の時刻は「いま」にする。5 分ちょうどまでは、そのまま", async () => {
    await send(
      sync([
        { senderMac: mac(1), seenAt: iso(5 * MINUTE) }, // ちょうど 5 分先
        { senderMac: mac(2), seenAt: iso(5 * MINUTE + 1000) }, // 5 分より先
      ]),
    );
    expect((await rowOf(mac(1)))?.lastSeenAt.toISOString()).toBe(
      iso(5 * MINUTE),
    );
    expect((await rowOf(mac(2)))?.lastSeenAt.toISOString()).toBe(iso(0));
  });

  it("T-DEV-006 小文字の MAC は大文字にそろえて保存する。同じ機器は 1 つの行", async () => {
    await send(sync([{ senderMac: "02:00:00:00:0a:bc", seenAt: iso(-1000) }]));
    await send(sync([{ senderMac: "02:00:00:00:0A:BC", seenAt: iso(-500) }]));
    const rows = await db().device.findMany();
    expect(rows.map((row) => row.espMac)).toEqual(["02:00:00:00:0A:BC"]);
  });
});

describe("未登録の機器の件数と期限", () => {
  it("T-DEV-007 未登録は 50 件まで。51 件目以降は作らない。すでにある機器の更新と、登録済みの機器の対応表は、影響を受けない", async () => {
    const receiver = await db().receiver.findUniqueOrThrow({
      where: { receiverId: "304" },
    });
    await db().device.create({
      data: {
        espMac: mac(900),
        receiverId: receiver.id,
        lastSeenAt: new Date(NOW_MS - 1000),
      },
    });
    const batch = Array.from({ length: 60 }, (_, index) => ({
      senderMac: mac(index + 1),
      seenAt: iso(-1000),
    }));
    // 1 回に送れるのは 100 台まで。60 台なら受け付けて、50 件だけ未登録として作る。
    const result = await send(sync(batch));
    expect(result.status).toBe(200);
    expect(await db().device.count({ where: { receiverId: null } })).toBe(50);
    expect(registered(result)).toEqual([`${mac(900)}=304`]);

    // 作られた 50 件のうち 1 台の更新は、上限に関係なく通る。
    const kept = (
      await db().device.findMany({ where: { receiverId: null } })
    )[0];
    await send(sync([{ senderMac: kept.espMac, seenAt: iso(-100) }]));
    expect((await rowOf(kept.espMac))?.lastSeenAt.toISOString()).toBe(
      iso(-100),
    );
    expect(await db().device.count({ where: { receiverId: null } })).toBe(50);
  });

  it("T-DEV-008 10 分来ない未登録の行は消える(10 分ちょうどは残り、それより長いと消える)。登録済みは、来なくても消えない", async () => {
    const receiver = await db().receiver.findUniqueOrThrow({
      where: { receiverId: "304" },
    });
    await db().device.createMany({
      data: [
        { espMac: mac(1), lastSeenAt: new Date(NOW_MS - 10 * MINUTE) }, // ちょうど 10 分前
        { espMac: mac(2), lastSeenAt: new Date(NOW_MS - 10 * MINUTE - 1) }, // 10 分より前
        { espMac: mac(3), lastSeenAt: new Date(NOW_MS - 60 * MINUTE) },
        {
          espMac: mac(4),
          receiverId: receiver.id,
          lastSeenAt: new Date(NOW_MS - 24 * 60 * MINUTE),
        },
      ],
    });
    const result = await send(sync([]));
    expect(result.status).toBe(200);
    const left = (
      await db().device.findMany({ orderBy: { espMac: "asc" } })
    ).map((row) => row.espMac);
    expect(left).toEqual([mac(1), mac(4)]);
    expect(registered(result)).toEqual([`${mac(4)}=304`]);
  });

  it("T-DEV-009 一覧に出す時間(10 分)を過ぎた古い時刻の機器は、新しく作らない", async () => {
    await send(
      sync([
        { senderMac: mac(1), seenAt: iso(-10 * MINUTE - 1000) }, // 古い
        { senderMac: mac(2), seenAt: iso(-10 * MINUTE) }, // ちょうど 10 分前は作る
      ]),
    );
    expect(await rowOf(mac(1))).toBeNull();
    expect(await rowOf(mac(2))).not.toBeNull();
  });
});

describe("受け付けない本文", () => {
  const good = () => sync([{ senderMac: mac(1), seenAt: iso(-1000) }]);

  it("T-DEV-010 MAC の形が違うもの(区切り、長さ、16 進でない文字、全 0、マルチキャスト)が 1 つでもあれば、全体を 400 で断る。何も保存しない", async () => {
    const bad = [
      "02-00-00-00-00-01", // 区切りが違う
      "020000000001",
      "02:00:00:00:00", // 5 つ
      "02:00:00:00:00:00:01",
      "0G:00:00:00:00:01",
      "00:00:00:00:00:00", // 全 0
      "FF:FF:FF:FF:FF:FF", // ブロードキャスト
      "01:00:00:00:00:01", // マルチキャスト(先頭の 1 バイトの最下位ビットが 1)
      "",
    ];
    for (const senderMac of bad) {
      const result = await send(
        sync([
          { senderMac: mac(5), seenAt: iso(-1000) },
          { senderMac, seenAt: iso(-1000) },
        ]),
      );
      expect(result.status, senderMac).toBe(400);
      expect(result.body, senderMac).toEqual({
        success: false,
        error: "invalid_request_body",
      });
    }
    expect(await countRows()).toBe(0);
  });

  it("T-DEV-011 本文の壊れ・形の違い: JSON でない 400、知らない項目 400、時刻の形が違う 400、機器が 101 台 400、Content-Type が違う 400", async () => {
    const broken = await send("{not json");
    expect(broken.status).toBe(400);
    expect(broken.body).toEqual({ success: false, error: "invalid_json" });

    const unknownField = await send({ ...good(), extra: 1 });
    const unknownInDevice = await send(
      sync([{ senderMac: mac(1), seenAt: iso(-1000), roomId: "304" } as never]),
    );
    const badTime = await send(
      sync([{ senderMac: mac(1), seenAt: "2026-11-10 10:00:00" }]),
    );
    const tooMany = await send(
      sync(
        Array.from({ length: 101 }, (_, index) => ({
          senderMac: mac(index + 1),
          seenAt: iso(-1000),
        })),
      ),
    );
    const wrongType = await send(JSON.stringify(good()), {
      contentType: "text/plain",
    });
    const noType = await send(JSON.stringify(good()), { contentType: null });
    const notAnObject = await send([]);
    for (const result of [
      unknownField,
      unknownInDevice,
      badTime,
      tooMany,
      wrongType,
      noType,
      notAnObject,
    ]) {
      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        success: false,
        error: "invalid_request_body",
      });
    }
    expect(await countRows()).toBe(0);
  });

  it("T-DEV-012 gatewayId が、ヘッダーの X-Gateway-ID と違うときは 400(gateway_id_mismatch)。何も保存しない", async () => {
    const result = await send(good(), {
      headers: { "x-gateway-id": GATEWAY },
    });
    expect(result.status).toBe(200); // 一致なら通る(対照)
    await resetDatabase();
    const mismatch = await send({ ...good(), gatewayId: "other" });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body).toEqual({
      success: false,
      error: "gateway_id_mismatch",
    });
    expect(await countRows()).toBe(0);
  });

  it("T-DEV-013 16KB まで受ける。16KB を超えれば 413(payload_too_large)。宣言の大きさ(Content-Length)でも、実際の大きさでも。保存しない", async () => {
    // 空白で、本文の大きさをそろえる(JSON として正しいまま)
    const padded = (bytes: number) => {
      const base = JSON.stringify(good());
      return base + " ".repeat(bytes - Buffer.byteLength(base));
    };
    const limit = padded(16 * 1024);
    expect(Buffer.byteLength(limit)).toBe(16 * 1024);
    expect((await send(limit)).status).toBe(200); // ちょうど 16KB は受ける
    await resetDatabase();

    const over = padded(16 * 1024 + 1);
    expect(Buffer.byteLength(over)).toBe(16 * 1024 + 1);
    const tooBig = await send(over);
    expect([tooBig.status, tooBig.body]).toEqual([
      413,
      { success: false, error: "payload_too_large" },
    ]);
    const declared = await send(good(), {
      headers: { "content-length": String(16 * 1024 + 1) },
    });
    expect([declared.status, declared.body]).toEqual([
      413,
      { success: false, error: "payload_too_large" },
    ]);
    expect(await countRows()).toBe(0);
  });
});

describe("受信機・教室との関係と、記録", () => {
  it("T-DEV-014 S25 で受信機を外す、または教室を消すと、その受信機の機器は未登録に戻り、対応表から消える(機器の行は残る)", async () => {
    const r304 = await db().receiver.findUniqueOrThrow({
      where: { receiverId: "304" },
    });
    const r305 = await db().receiver.findUniqueOrThrow({
      where: { receiverId: "305" },
    });
    // 消すための教室(ホームルーム教室は、使われているので消せない。R5-7)
    const spare = await db().room.create({
      data: { name: "予備室", kind: "FREE" },
    });
    const r306 = await db().receiver.create({
      data: { receiverId: "306", roomId: spare.id },
    });
    await db().device.createMany({
      data: [
        { espMac: mac(1), receiverId: r304.id, lastSeenAt: new Date(NOW_MS) },
        { espMac: mac(2), receiverId: r305.id, lastSeenAt: new Date(NOW_MS) },
        { espMac: mac(3), receiverId: r306.id, lastSeenAt: new Date(NOW_MS) },
      ],
    });
    await db().receiver.delete({ where: { id: r304.id } }); // S25 の「外す」と同じ削除
    let result = await send(sync([]));
    expect(registered(result)).toEqual([`${mac(2)}=305`, `${mac(3)}=306`]);
    expect((await rowOf(mac(1)))?.receiverId).toBeNull();

    await db().room.delete({ where: { id: spare.id } }); // 教室を消すと、受信機も一緒に消える(R5-7)
    result = await send(sync([]));
    expect(registered(result)).toEqual([`${mac(2)}=305`]);
    expect((await rowOf(mac(3)))?.receiverId).toBeNull();
    expect(await countRows()).toBe(3); // 機器の行は、どれも残る
  });

  it("T-DEV-015 ログは 1 行で、鍵・Authorization・機器の MAC を出さない", async () => {
    await send(sync([{ senderMac: mac(77), seenAt: iso(-1000) }]));
    const lines = info.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("gateway.device-sync");
    expect(lines[0]).not.toContain(KEY);
    expect(lines[0]).not.toContain(mac(77));
    expect(lines[0]).not.toMatch(/authorization|bearer/i);
  });

  it("T-DEV-016 DB につながらなければ 503(database_unavailable。送り直してよい)。ほかのエラーは 500。接続先や秘密の値は、答えにも、ログにも出さない", async () => {
    const secret = "postgres://user:secretpass@db.internal:5432/mieroom";
    const body = sync([{ senderMac: mac(1), seenAt: iso(-1000) }]);

    dbControl.fail = Object.assign(
      new Error(`connect ECONNREFUSED ${secret}`),
      {
        code: "P1001",
      },
    );
    const unavailable = await send(body);
    expect([unavailable.status, unavailable.body]).toEqual([
      503,
      { success: false, error: "database_unavailable" },
    ]);

    dbControl.fail = new Error(`boom at ${secret}`);
    const broken = await send(body);
    expect([broken.status, broken.body]).toEqual([
      500,
      { success: false, error: "internal_server_error" },
    ]);

    const shown = JSON.stringify([
      unavailable.body,
      broken.body,
      errorLog.mock.calls,
      info.mock.calls,
    ]);
    expect(shown).not.toContain("secretpass");
    expect(shown).not.toContain("db.internal");
    expect(errorLog).toHaveBeenCalled();
  });
});
