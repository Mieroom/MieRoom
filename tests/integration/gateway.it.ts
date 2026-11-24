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
import { ID, ROOM_FREE_NAME, seedBase } from "./support/fixtures";

// 位置の受け取り(IF01。T-GW、テスト設計書 4-7): the route, the real saving code and a real database.
// 基準の「いま」は 2026-11-10(火)10:00 JST(= 01:00:00 UTC)。ゲートウェイの鍵と ID は、環境の読み込みを
// 差し替えて決める(未設定の確認のため)。DB に届かない状態は、DB の取り出しを差し替えて作る。
// 先生の位置の表示(S05)は、画面が使う loadTeacherDirectory で確かめる。
// 期待値は、外部設計書(09章 IF01、規則 R7-1・R7-2)とテスト設計書 4-7 から書いた
// (tests/cases/gateway.cases.ts と同じ内容)。

const KEY = "9f".repeat(32); // 64 文字
const GATEWAY = "school-pc-001";
const cfg = vi.hoisted(() => ({ key: "", id: "" }));
const dbControl = vi.hoisted(() => ({
  calls: 0,
  fail: null as null | Error,
}));
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
      dbControl.calls += 1;
      if (dbControl.fail !== null) throw dbControl.fail;
      return testDb();
    },
  };
});

import { POST } from "@/app/api/gateway/location-events/route";
import { loadTeacherDirectory } from "@/lib/server/queries/common";

const HOST = "mieroom.example";
const URL = `https://${HOST}/api/gateway/location-events`;
const NOW_MS = Date.parse("2026-11-10T10:00:00+09:00");
const iso = (secondsFromNow: number) =>
  new Date(NOW_MS + secondsFromNow * 1000).toISOString();
let counter = 0;
const eventId = () =>
  `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`;

const event = (over: Record<string, unknown> = {}) => ({
  eventId: eventId(),
  eventType: "teacher_location_changed",
  gatewayId: GATEWAY,
  minor: 12, // 講師「田村」のタグ ID
  roomId: "304", // 教室「展示室」の受信機 ID
  previousRoomId: null,
  status: "detected",
  previousStatus: null,
  occurredAt: iso(-30),
  ...over,
});

type Sent = {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
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
    headers: response.headers,
  };
}

const db = () => testDb();
const tamura = async () =>
  (await loadTeacherDirectory(2026, "")).find((row) => row.id === ID.teacher)
    ?.location;
const locationOf = () =>
  db().location.findUnique({ where: { teacherId: ID.teacher } });

let info: ReturnType<typeof vi.spyOn>;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_MS));
  await resetDatabase();
  await seedBase(); // 講師「田村」(タグ 12)、教室「展示室」「101」
  await db().receiver.createMany({
    data: [
      { receiverId: "304", roomId: ID.roomFree },
      { receiverId: "305", roomId: ID.roomHome },
    ],
  });
  cfg.key = KEY;
  cfg.id = GATEWAY;
  dbControl.calls = 0;
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

describe("受け取って保存する", () => {
  it("T-GW-001 正しい鍵・ID・新しいイベントは 200。先生の位置が、S05 に教室名で出る", async () => {
    const body = event();
    const result = await send(body);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      duplicate: false,
      currentLocationUpdated: true,
      eventId: body.eventId,
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await tamura()).toEqual({ kind: "room", room: ROOM_FREE_NAME });
    const row = await locationOf();
    expect(row).toMatchObject({
      roomId: ID.roomFree,
      status: "DETECTED",
      lastEventId: body.eventId,
    });
    expect(row?.lastOccurredAt.toISOString()).toBe(body.occurredAt);
  });

  it("T-GW-002 同じイベント(eventId)の再送は 200 と duplicate: true(409 にしない)。位置は 1 件のまま", async () => {
    const body = event();
    await send(body);
    const again = await send(body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({
      success: true,
      duplicate: true,
      eventId: body.eventId,
    });
    expect(await db().location.count()).toBe(1);
    expect(await tamura()).toEqual({ kind: "room", room: ROOM_FREE_NAME });
  });

  it("T-GW-003a 古いイベントは 200 と older_event。位置は戻らない", async () => {
    await send(event({ roomId: "305", occurredAt: iso(-10) })); // 新しい: 教室「101」
    const old = event({ roomId: "304", occurredAt: iso(-40) });
    const result = await send(old);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      duplicate: false,
      currentLocationUpdated: false,
      reason: "older_event",
      eventId: old.eventId,
    });
    expect(await tamura()).toEqual({ kind: "room", room: "101" });
  });

  it("T-GW-003b 発生時刻が、いまの位置と同じ(別のイベント)も older_event。位置は変わらない", async () => {
    await send(event({ roomId: "305", occurredAt: iso(-10) }));
    const same = event({ roomId: "304", occurredAt: iso(-10) });
    const result = await send(same);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      currentLocationUpdated: false,
      reason: "older_event",
    });
    expect(await tamura()).toEqual({ kind: "room", room: "101" });
  });

  it("T-GW-004a 登録のない minor は 200 と unknown_teacher(エラーにしない)。位置は作られない。minor は 0〜65535", async () => {
    for (const minor of [999, 0, 65535]) {
      const body = event({ minor });
      const result = await send(body);
      expect([minor, result.status]).toEqual([minor, 200]);
      expect(result.body).toEqual({
        success: true,
        duplicate: false,
        currentLocationUpdated: false,
        reason: "unknown_teacher",
        eventId: body.eventId,
      });
    }
    expect(await db().location.count()).toBe(0);
  });

  it("T-GW-004b 登録のない roomId は 200 と unknown_room(エラーにしない)。いまの位置は変わらない", async () => {
    await send(event({ roomId: "305", occurredAt: iso(-60) }));
    const body = event({ roomId: "999", occurredAt: iso(-10) });
    const result = await send(body);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      duplicate: false,
      currentLocationUpdated: false,
      reason: "unknown_room",
      eventId: body.eventId,
    });
    expect(await tamura()).toEqual({ kind: "room", room: "101" });
  });

  it("T-GW-010 状態: detected と unknown は教室名、offline は「検知エリア外」。教室が null の offline も受ける", async () => {
    const at = (offset: number) => iso(-100 + offset);
    expect(
      (
        await send(
          event({ status: "detected", roomId: "304", occurredAt: at(0) }),
        )
      ).status,
    ).toBe(200);
    expect(await tamura()).toEqual({ kind: "room", room: ROOM_FREE_NAME });

    await send(
      event({
        eventType: "teacher_status_changed",
        status: "unknown",
        roomId: "304",
        occurredAt: at(10),
      }),
    );
    expect(await tamura()).toEqual({ kind: "room", room: ROOM_FREE_NAME });

    await send(
      event({
        eventType: "teacher_status_changed",
        status: "offline",
        roomId: "304",
        occurredAt: at(20),
      }),
    );
    expect(await tamura()).toEqual({ kind: "out-of-area" });

    // 教室が null の offline
    await send(
      event({ status: "detected", roomId: "305", occurredAt: at(30) }),
    );
    expect(await tamura()).toEqual({ kind: "room", room: "101" });
    const nullRoom = await send(
      event({
        eventType: "teacher_status_changed",
        status: "offline",
        roomId: null,
        occurredAt: at(40),
      }),
    );
    expect(nullRoom.body).toMatchObject({ currentLocationUpdated: true });
    expect(await tamura()).toEqual({ kind: "out-of-area" });
  });

  it("T-GW-009 発生時刻がサーバーの時刻より 5 分より先なら、受けた時刻で保存する。ちょうど 5 分先は、そのまま", async () => {
    const exact = event({ occurredAt: iso(300) }); // ちょうど 5 分先
    await send(exact);
    expect((await locationOf())?.lastOccurredAt.toISOString()).toBe(iso(300));

    await db().location.deleteMany({});
    const ahead = event({ occurredAt: iso(301) }); // 5 分より先
    const result = await send(ahead);
    expect(result.body).toMatchObject({ currentLocationUpdated: true });
    expect((await locationOf())?.lastOccurredAt.toISOString()).toBe(iso(0));

    // 位置は固定されない: 正しい時刻の、このあとのイベントが、位置を更新できる
    const next = event({ roomId: "305", occurredAt: iso(5) });
    const updated = await send(next);
    expect(updated.body).toMatchObject({ currentLocationUpdated: true });
    expect(await tamura()).toEqual({ kind: "room", room: "101" });
  });

  it("T-GW-014 同時に届いても、遅れて届いても、位置は新しいほうになる(どちらの順でも)", async () => {
    for (let round = 0; round < 6; round += 1) {
      await db().location.deleteMany({});
      const newer = event({ roomId: "305", occurredAt: iso(-10) });
      const older = event({ roomId: "304", occurredAt: iso(-50) });
      await Promise.all(
        round % 2 === 0
          ? [send(newer), send(older)]
          : [send(older), send(newer)],
      );
      const row = await locationOf();
      expect([round, row?.lastEventId]).toEqual([round, newer.eventId]);
      expect(row?.roomId).toBe(ID.roomHome);
    }
  });
});

describe("認証(鍵・ゲートウェイ ID)", () => {
  it("T-GW-005 鍵が違う・ID が違う・ヘッダーがない・形が違うは 401 と unauthorized。どちらが違うかは分からない。DB は読まない", async () => {
    const body = event();
    const wrongKey = await send(body, {
      headers: { authorization: `Bearer ${"00".repeat(32)}` },
    });
    const wrongId = await send(body, { headers: { "x-gateway-id": "other" } });
    const results = [
      wrongKey,
      wrongId,
      await send(body, { headers: { authorization: null } }),
      await send(body, { headers: { "x-gateway-id": null } }),
      await send(body, {
        headers: { authorization: null, "x-gateway-id": null },
      }),
      await send(body, { headers: { authorization: `Basic ${KEY}` } }),
      await send(body, { headers: { authorization: `Bearer ${KEY} extra` } }),
      // 認証より前に、本文は読まない(壊れた本文でも 401)
      await send("{broken", { headers: { authorization: null } }),
    ];
    for (const result of results) {
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ success: false, error: "unauthorized" });
    }
    expect(wrongKey.body).toEqual(wrongId.body);
    expect(dbControl.calls).toBe(0);
    expect(await db().location.count()).toBe(0);
  });

  it("T-GW-006 鍵か ID が未設定なら、403 と gateway_disabled。DB は読まない", async () => {
    for (const [key, id] of [
      ["", GATEWAY],
      [KEY, ""],
      ["", ""],
    ]) {
      cfg.key = key;
      cfg.id = id;
      const result = await send(event());
      expect([key === "", id === "", result.status]).toEqual([
        key === "",
        id === "",
        403,
      ]);
      expect(result.body).toEqual({
        success: false,
        error: "gateway_disabled",
      });
    }
    expect(dbControl.calls).toBe(0);
    expect(await db().location.count()).toBe(0);
  });
});

describe("形の検証", () => {
  it("T-GW-007a JSON が壊れていれば 400 と invalid_json", async () => {
    for (const text of ["{broken", "", '{"eventId":']) {
      const result = await send(text);
      expect([text, result.status, result.body]).toEqual([
        text,
        400,
        { success: false, error: "invalid_json" },
      ]);
    }
  });

  it("T-GW-007b 項目・型が違えば 400 と invalid_request_body。Content-Type が違うときも。保存しない", async () => {
    const bad: [string, unknown][] = [
      ["eventId がない", { ...event(), eventId: undefined }],
      ["eventId が UUID でない", event({ eventId: "not-a-uuid" })],
      ["eventType が違う", event({ eventType: "heartbeat" })],
      ["minor がない", { ...event(), minor: undefined }],
      ["roomId がない", { ...event(), roomId: undefined }],
      ["roomId が数字", event({ roomId: 304 })],
      ["roomId が空", event({ roomId: "" })],
      ["roomId が 65 文字", event({ roomId: "x".repeat(65) })],
      ["status が違う", event({ status: "online" })],
      ["status がない", { ...event(), status: undefined }],
      ["occurredAt が日時でない", event({ occurredAt: "yesterday" })],
      ["occurredAt がない", { ...event(), occurredAt: undefined }],
      ["gatewayId が空", event({ gatewayId: "" })],
      ["gatewayId が 65 文字", event({ gatewayId: "g".repeat(65) })],
      ["本文が配列", []],
      ["本文が null", null],
      ["本文が文字", "12"],
    ];
    for (const [label, body] of bad) {
      const result = await send(body);
      expect([label, result.status, result.body]).toEqual([
        label,
        400,
        { success: false, error: "invalid_request_body" },
      ]);
    }
    for (const contentType of [
      "text/plain",
      null,
      "application/x-www-form-urlencoded",
    ]) {
      const result = await send(event(), { contentType });
      expect([contentType, result.status, result.body]).toEqual([
        contentType,
        400,
        { success: false, error: "invalid_request_body" },
      ]);
    }
    expect(await db().location.count()).toBe(0);
  });

  it("T-GW-007c ヘッダーと本文の gatewayId が違えば 400 と gateway_id_mismatch。保存しない", async () => {
    const result = await send(event({ gatewayId: "other-gateway" }));
    expect([result.status, result.body]).toEqual([
      400,
      { success: false, error: "gateway_id_mismatch" },
    ]);
    expect(await db().location.count()).toBe(0);
  });

  it('T-GW-011 minor が文字列 "12" は 400(拒否)。整数でない・範囲外も 400。0 と 65535 は受ける', async () => {
    for (const minor of ["12", 12.5, -1, 65536, true, null]) {
      const result = await send(event({ minor }));
      expect([String(minor), result.status, result.body]).toEqual([
        String(minor),
        400,
        { success: false, error: "invalid_request_body" },
      ]);
    }
    expect(await db().location.count()).toBe(0);
    for (const minor of [0, 65535]) {
      const result = await send(event({ minor }));
      expect([minor, result.status]).toEqual([minor, 200]);
    }
  });

  it("T-GW-008 16KB まで受ける。16KB を超えれば 413 と payload_too_large(宣言の大きさでも、実際の大きさでも)。保存しない", async () => {
    const padded = (bytes: number) => {
      const base = event({ pad: "" });
      const extra = bytes - Buffer.byteLength(JSON.stringify(base));
      return JSON.stringify({ ...base, pad: "x".repeat(extra) });
    };
    const limit = padded(16 * 1024);
    expect(Buffer.byteLength(limit)).toBe(16 * 1024);
    const ok = await send(limit);
    expect(ok.status).toBe(200); // ちょうど 16KB は受ける

    const over = padded(16 * 1024 + 1);
    expect(Buffer.byteLength(over)).toBe(16 * 1024 + 1);
    const tooBig = await send(over);
    expect([tooBig.status, tooBig.body]).toEqual([
      413,
      { success: false, error: "payload_too_large" },
    ]);
    // 宣言の大きさ(Content-Length)が 16KB を超える
    const declared = await send(event(), {
      headers: { "content-length": String(16 * 1024 + 1) },
    });
    expect([declared.status, declared.body]).toEqual([
      413,
      { success: false, error: "payload_too_large" },
    ]);
    expect(await db().location.count()).toBe(1); // ちょうど 16KB の 1 件だけ
  });
});

describe("エラーの返し方とログ", () => {
  it("T-GW-012 DB につながらなければ 503 と database_unavailable(送り直してよい)。ほかのエラーは 500。中身は返さない", async () => {
    dbControl.fail = Object.assign(
      new Error(
        "connect ECONNREFUSED postgres://user:secretpass@db.internal:5432",
      ),
      { code: "P1001" },
    );
    const unavailable = await send(event());
    expect([unavailable.status, unavailable.body]).toEqual([
      503,
      { success: false, error: "database_unavailable" },
    ]);

    dbControl.fail = new Error(
      "boom at postgres://user:secretpass@db.internal:5432/mieroom",
    );
    const broken = await send(event());
    expect([broken.status, broken.body]).toEqual([
      500,
      { success: false, error: "internal_server_error" },
    ]);

    // 返した本文にも、ログにも、接続先や秘密の値が出ない
    const everything = JSON.stringify([
      unavailable.body,
      broken.body,
      info.mock.calls,
      errorLog.mock.calls,
    ]);
    expect(everything).not.toContain("secretpass");
    expect(everything).not.toContain("postgres://");
    expect(everything).not.toContain("db.internal");
    expect(everything).not.toContain(KEY);
  });

  it("T-GW-013 ログは、受信ごとに 1 行。鍵・Authorization・教員・教室は出さない", async () => {
    const body = event({ roomId: "304", minor: 12 });
    const ok = await send(body);
    expect(ok.status).toBe(200);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      eventId: body.eventId,
      gatewayId: GATEWAY,
      eventType: "teacher_location_changed",
      state: "detected",
      status: 200,
    });
    expect(typeof parsed.ms).toBe("number");
    expect(parsed.outcome).toBeDefined();

    // 認証に失敗した受信も 1 行。教員の minor、教室、鍵は、どのログにも出ない
    const denied = await send(body, {
      headers: { authorization: "Bearer wrong" },
    });
    expect(denied.status).toBe(401);
    expect(info).toHaveBeenCalledTimes(2);
    const all = info.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join("\n");
    for (const secret of [
      KEY,
      "Bearer",
      "authorization",
      "田村",
      ROOM_FREE_NAME,
    ]) {
      expect(all, secret).not.toContain(secret);
    }
    expect(all).not.toContain('"minor"');
    expect(all).not.toContain('"roomId"');
  });
});
