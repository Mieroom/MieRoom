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
import { textToDateColumn } from "@/lib/domain/school-date";
import { MESSAGES, SYSTEM_ERROR_MESSAGE } from "@/lib/messages";
import { testDb, closeDatabase, resetDatabase } from "./support/db";
import {
  ID,
  PERIOD,
  ROOM_FREE_NAME,
  USERS,
  seedBase,
  type TestRole,
} from "./support/fixtures";

// 承認・却下・取消 (T-APR) と、承認の条件 (T-IMP-029): the routes, the server functions and a
// real database (テスト設計書 4-3, 11-2). The clock is fixed to Japan time: 2026-11-10 (火) 10:00
// unless a case says otherwise. 標準の予約: 11/16 (月)・1限前半 (09:15 開始)・承認待ち。
// 期待値は、外部設計書とテスト設計書から書いた(tests/cases/reservation.cases.ts と同じ内容)。

vi.mock("server-only", () => ({}));
type TestUser = { id: string; name: string; role: TestRole };
const session = vi.hoisted(() => ({
  user: null as null | TestUser,
  /** 同時の操作の確認用。呼び出しごとに、先頭から順にこの人になる(空なら user) */
  queue: [] as TestUser[],
}));
vi.mock("@/lib/server/session", async () => {
  const { hasRole } = await import("./support/session");
  return {
    getCurrentUser: async () => session.queue.shift() ?? session.user,
    hasRole,
  };
});
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./support/db");
  return { getDb: () => testDb() };
});

import { POST as approve } from "@/app/(main)/teacher/reservations/approve/route";
import { POST as cancel } from "@/app/(main)/teacher/reservations/cancel/route";
import { POST as reject } from "@/app/(main)/teacher/reservations/reject/route";

const HOST = "mieroom.example";
const DAY = "2026-11-16"; // 月曜。1限前半は 09:15 に始まる
const OTHER_CLASS = "00000000-0000-4000-8000-000000000011";
const NOT_FOUND_ID = "00000000-0000-4000-8000-0000000000ff";

const at = (jst: string) => vi.setSystemTime(new Date(`${jst}:00+09:00`));

function request(path: string, body: string) {
  return new NextRequest(`https://${HOST}${path}`, {
    method: "POST",
    headers: {
      host: HOST,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body,
  });
}
const post = (path: string, body: unknown) =>
  request(path, JSON.stringify(body));

const OPS = {
  approve: { handler: approve, path: "/teacher/reservations/approve" },
  reject: { handler: reject, path: "/teacher/reservations/reject" },
  cancel: { handler: cancel, path: "/teacher/reservations/cancel" },
} as const;
type Op = keyof typeof OPS;

const run = (op: Op, id: unknown, extra: Record<string, unknown> = {}) =>
  OPS[op].handler(post(OPS[op].path, { id, ...extra }));

type Status = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "WITHDRAWN";

/** DB に直接、予約を作る(状態を自由に決めるため)。 */
async function reserve(
  input: { status?: Status; date?: string; slots?: number[] } = {},
): Promise<string> {
  const row = await testDb().reservation.create({
    data: {
      roomId: ID.roomFree,
      date: textToDateColumn(input.date ?? DAY),
      purpose: "自習",
      status: input.status ?? "PENDING",
      applicantId: USERS.student.id,
      applicantName: USERS.student.name,
      slots: { create: (input.slots ?? [1]).map((slot) => ({ slot })) },
    },
    select: { id: true },
  });
  return row.id;
}

const stateOf = (id: string) =>
  testDb().reservation.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      handledById: true,
      handledByName: true,
      handledAt: true,
    },
  });

/** そのクラスの、その月の時間割を「取込済み」にする(入力済み。R3-7)。 */
const enterMonth = (classId: string, month: string) =>
  testDb().monthStatus.create({
    data: { classId, month, importedAt: new Date() },
  });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T10:00");
  await resetDatabase();
  await seedBase();
  await enterMonth(ID.classA, "202611");
  session.user = USERS.teacher;
  session.queue = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDatabase();
});

describe("承認・却下・取消(正常)", () => {
  it("T-APR-001 承認できる(MI201)。対応した先生と日時が残る", async () => {
    const id = await reserve();
    const response = await run("approve", id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notice: "MI201" });
    expect(await stateOf(id)).toEqual({
      status: "APPROVED",
      handledById: USERS.teacher.id,
      handledByName: USERS.teacher.name,
      handledAt: new Date("2026-11-10T10:00:00+09:00"),
    });
  });

  it("T-APR-002 却下できる(MI202)。対応した先生と日時が残る", async () => {
    const id = await reserve();
    const response = await run("reject", id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notice: "MI202" });
    expect(await stateOf(id)).toEqual({
      status: "REJECTED",
      handledById: USERS.teacher.id,
      handledByName: USERS.teacher.name,
      handledAt: new Date("2026-11-10T10:00:00+09:00"),
    });
  });

  it("T-APR-003 承認済みを取り消せる(MI203)。対応した先生が取り消した先生になる", async () => {
    const id = await reserve({ status: "APPROVED" });
    const response = await run("cancel", id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notice: "MI203" });
    expect(await stateOf(id)).toEqual({
      status: "CANCELLED",
      handledById: USERS.teacher.id,
      handledByName: USERS.teacher.name,
      handledAt: new Date("2026-11-10T10:00:00+09:00"),
    });
  });
});

describe("枠が始まる時刻の境界(R4-6)", () => {
  it("T-APR-004 取消は最初の枠の開始まで: 09:14 は可、09:15 は ME205", async () => {
    const before = await reserve({ status: "APPROVED" });
    const started = await reserve({ status: "APPROVED" });
    const later = await reserve({ status: "APPROVED", slots: [3] });
    at("2026-11-16T09:14");
    expect((await run("cancel", before)).status).toBe(200);
    at("2026-11-16T09:15");
    const response = await run("cancel", started);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: MESSAGES.ME205 });
    expect((await stateOf(started)).status).toBe("APPROVED");
    // 2限前半 (11:00 開始) は、09:15 の時点では、まだ取り消せる
    expect((await run("cancel", later)).status).toBe(200);
    expect((await stateOf(before)).status).toBe("CANCELLED");
  });

  it("T-APR-005 承認・却下は、最初の枠が始まったあと(09:15)は ME204。状態は変わらない", async () => {
    const id = await reserve();
    at("2026-11-16T09:15");
    for (const op of ["approve", "reject"] as const) {
      const response = await run(op, id);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ message: MESSAGES.ME204 });
    }
    expect(await stateOf(id)).toMatchObject({
      status: "PENDING",
      handledById: null,
    });
  });
});

describe("同時の操作(R4-6。ME902)", () => {
  it("T-APR-009 承認と却下が同時に来ても、成功は 1 つだけ。もう 1 つは ME902", async () => {
    const id = await reserve();
    session.queue = [USERS.teacher, USERS.admin]; // 呼び出しの順に、承認は先生、却下は管理者
    const [approved, rejected] = await Promise.all([
      run("approve", id),
      run("reject", id),
    ]);
    expect([approved.status, rejected.status].sort()).toEqual([200, 409]);
    const loser = approved.status === 409 ? approved : rejected;
    expect(await loser.json()).toEqual({ message: MESSAGES.ME902 });
    const row = await stateOf(id);
    if (approved.status === 200) {
      expect(row).toMatchObject({
        status: "APPROVED",
        handledById: USERS.teacher.id,
      });
    } else {
      expect(row).toMatchObject({
        status: "REJECTED",
        handledById: USERS.admin.id,
      });
    }
  });

  it("T-APR-009b 承認どうしが同時に来ても、成功は 1 つだけ。もう 1 つは ME902", async () => {
    const id = await reserve();
    session.queue = [USERS.teacher, USERS.admin];
    const [first, second] = await Promise.all([
      run("approve", id),
      run("approve", id),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(await loser.json()).toEqual({ message: MESSAGES.ME902 });
    expect((await stateOf(id)).status).toBe("APPROVED");
  });
});

describe("承認の条件(R4-7、R3-7)", () => {
  it("T-APR-010 時間割が未入力のクラスがあれば、ME201(クラス名つき)。状態は変わらない", async () => {
    await testDb().schoolClass.create({
      data: {
        id: OTHER_CLASS,
        name: "デザイン専攻1年",
        homeRoomId: ID.roomHome,
        startYear: 2026,
      },
    });
    const id = await reserve();
    const response = await run("approve", id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: MESSAGES.ME201("デザイン専攻1年"),
    });
    expect((await stateOf(id)).status).toBe("PENDING");
  });

  it("T-IMP-029 全クラスが入力済みなら、承認できる", async () => {
    await testDb().schoolClass.create({
      data: {
        id: OTHER_CLASS,
        name: "デザイン専攻1年",
        homeRoomId: ID.roomHome,
        startYear: 2026,
      },
    });
    await enterMonth(OTHER_CLASS, "202611");
    const id = await reserve();
    const response = await run("approve", id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notice: "MI201" });
  });

  it("T-APR-011 翌月の仮の時間割だけの日: 最終入力日の 12/11 は承認できる、12/14 は ME201", async () => {
    await testDb().monthStatus.update({
      where: { classId_month: { classId: ID.classA, month: "202611" } },
      data: { nextLastInputDate: textToDateColumn("2026-12-11") },
    });
    const inside = await reserve({ date: "2026-12-11" });
    const outside = await reserve({ date: "2026-12-14" });
    expect((await run("approve", inside)).status).toBe(200);
    const response = await run("approve", outside);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: MESSAGES.ME201("システム専攻1年"),
    });
  });

  it("T-APR-012 申請のあとに授業が入った枠は ME202。状態は変わらない", async () => {
    const id = await reserve();
    await testDb().lesson.create({
      data: {
        classId: ID.classA,
        date: textToDateColumn(DAY),
        startMinutes: PERIOD.p1.start,
        endMinutes: PERIOD.p1.end,
        subjectName: "プログラミング",
        roomId: ID.roomFree,
        roomName: ROOM_FREE_NAME,
        kind: "FIXED",
      },
    });
    const response = await run("approve", id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: MESSAGES.ME202 });
    expect((await stateOf(id)).status).toBe("PENDING");
  });

  it("T-APR-013 申請のあとに使用止めが入った枠は ME203。状態は変わらない", async () => {
    const id = await reserve();
    await testDb().roomBlock.create({
      data: {
        roomId: ID.roomFree,
        startDate: textToDateColumn(DAY),
        startPeriod: 1,
        endDate: textToDateColumn(DAY),
        endPeriod: 1,
        setById: USERS.teacher.id,
        setByName: USERS.teacher.name,
      },
    });
    const response = await run("approve", id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: MESSAGES.ME203 });
    expect((await stateOf(id)).status).toBe("PENDING");
  });

  it("T-APR-015 同じ枠に承認済みがあれば、確認(MC201)が先。確認したら承認できる", async () => {
    await reserve({ status: "APPROVED" });
    const id = await reserve();
    const asked = await run("approve", id);
    expect(asked.status).toBe(409);
    expect(await asked.json()).toEqual({
      confirm: true,
      message: MESSAGES.MC201,
    });
    expect((await stateOf(id)).status).toBe("PENDING");
    const confirmed = await run("approve", id, { confirmed: true });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ notice: "MI201" });
  });
});

describe("ない状態の移り変わり(R4-6)は ME902。状態は変わらない", () => {
  const NAME: Record<Status, string> = {
    PENDING: "承認待ち",
    APPROVED: "承認済み",
    REJECTED: "却下済み",
    CANCELLED: "取消済み",
    WITHDRAWN: "取り下げ済み",
  };
  const OP_NAME: Record<Op, string> = {
    approve: "承認",
    reject: "却下",
    cancel: "取消",
  };
  const ARROWS: { id: string; from: Status; op: Op }[] = [
    { id: "T-APR-022", from: "REJECTED", op: "approve" },
    { id: "T-APR-023a", from: "WITHDRAWN", op: "approve" },
    { id: "T-APR-023b", from: "WITHDRAWN", op: "reject" },
    { id: "T-APR-024", from: "PENDING", op: "cancel" },
    { id: "T-APR-025", from: "APPROVED", op: "reject" },
    { id: "T-APR-026a", from: "CANCELLED", op: "approve" },
    { id: "T-APR-026b", from: "CANCELLED", op: "cancel" },
  ];
  for (const arrow of ARROWS) {
    it(`${arrow.id} ${NAME[arrow.from]}を${OP_NAME[arrow.op]}すると ME902`, async () => {
      const id = await reserve({ status: arrow.from });
      const response = await run(arrow.op, id);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ message: MESSAGES.ME902 });
      expect(await stateOf(id)).toMatchObject({
        status: arrow.from,
        handledById: null,
      });
    });
  }
});

describe("形の違う入力", () => {
  it("T-APR-030 存在しない予約・UUID でない文字列・id なしは 404。何も変わらない", async () => {
    const id = await reserve();
    for (const bad of [NOT_FOUND_ID, "not-a-uuid", undefined]) {
      const response = await run("approve", bad);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: SYSTEM_ERROR_MESSAGE });
    }
    expect((await stateOf(id)).status).toBe("PENDING");
  });

  it("T-APR-031 本文が JSON でなければ 400。何も変わらない", async () => {
    const id = await reserve();
    const response = await approve(
      request("/teacher/reservations/approve", "{"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: SYSTEM_ERROR_MESSAGE });
    expect((await stateOf(id)).status).toBe("PENDING");
  });
});
