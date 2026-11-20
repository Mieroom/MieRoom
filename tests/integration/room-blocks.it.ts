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

// 使用止め (T-BLK): the routes, the server functions and a real database (テスト設計書 4-4).
// The clock is fixed to Japan time: 2026-11-10 (火) 10:00 unless a case says otherwise.
// 期間は、開始日の開始時限から、終了日の終了時限まで。時限: 1限 09:15、2限 11:00、3限 13:30、
// 4限 15:15。予約の枠: 1=1限前半, 2=1限後半, 3=2限前半, ... 5=3限前半, 7=4限前半。
// 期待値は、外部設計書とテスト設計書から書いた(tests/cases/room-block.cases.ts と同じ内容)。

vi.mock("server-only", () => ({}));
type TestUser = { id: string; name: string; role: TestRole };
const session = vi.hoisted(() => ({ user: null as null | TestUser }));
vi.mock("@/lib/server/session", async () => {
  const { hasRole } = await import("./support/session");
  return { getCurrentUser: async () => session.user, hasRole };
});
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./support/db");
  return { getDb: () => testDb() };
});

import { POST as apply } from "@/app/(main)/reservations/apply/route";
import { POST as approve } from "@/app/(main)/teacher/reservations/approve/route";
import { POST as createBlock } from "@/app/(main)/teacher/blocks/create/route";
import { POST as releaseBlock } from "@/app/(main)/teacher/blocks/release/route";

const HOST = "mieroom.example";
const DAY = "2026-11-16"; // 月曜
const NEXT_DAY = "2026-11-17";
const NOT_FOUND_ID = "00000000-0000-4000-8000-0000000000ff";
const CLASS_B = "00000000-0000-4000-8000-000000000011";
const CLASS_C = "00000000-0000-4000-8000-000000000012";

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

type BlockInput = {
  roomId?: unknown;
  startDate?: unknown;
  startPeriod?: unknown;
  endDate?: unknown;
  endPeriod?: unknown;
};

/** 設定する(S13)。何も指定しないものは、展示室・11/16 の 1限〜1限。 */
const block = (input: BlockInput = {}) =>
  createBlock(
    post("/teacher/blocks/create", {
      roomId: ID.roomFree,
      startDate: DAY,
      startPeriod: 1,
      endDate: DAY,
      endPeriod: 1,
      ...input,
    }),
  );

const release = (id: unknown) =>
  releaseBlock(post("/teacher/blocks/release", { id }));

const book = (slots: number[], date = DAY) =>
  apply(
    post("/reservations/apply", {
      roomId: ID.roomFree,
      date,
      slots,
      purpose: "自習",
      note: "",
    }),
  );

type Status = "PENDING" | "APPROVED";
async function reserve(
  status: Status,
  slot: number,
  date = DAY,
): Promise<string> {
  const row = await testDb().reservation.create({
    data: {
      roomId: ID.roomFree,
      date: textToDateColumn(date),
      purpose: "自習",
      status,
      applicantId: USERS.student.id,
      applicantName: USERS.student.name,
      slots: { create: [{ slot }] },
    },
    select: { id: true },
  });
  return row.id;
}

const blockCount = () => testDb().roomBlock.count();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T10:00");
  await resetDatabase();
  await seedBase();
  session.user = USERS.teacher;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDatabase();
});

describe("設定する(R4-10)", () => {
  it("T-BLK-001 設定できる(MI301)。設定した先生が残る。重なりは 0 件", async () => {
    const response = await block({ endPeriod: 2 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notice: "MI301",
      reservations: 0,
      lessons: 0,
    });
    const rows = await testDb().roomBlock.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      roomId: ID.roomFree,
      startPeriod: 1,
      endPeriod: 2,
      setById: USERS.teacher.id,
      setByName: USERS.teacher.name,
    });
    expect(rows[0].startDate).toEqual(textToDateColumn(DAY));
    expect(rows[0].endDate).toEqual(textToDateColumn(DAY));
  });

  it("T-BLK-001b 設定した枠は、申請できない(ME106)。ほかの枠は申請できる", async () => {
    await block({ endPeriod: 2 });
    session.user = USERS.student;
    const refused = await book([1]);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { issues: { code: string }[] };
    expect(body.issues.map((issue) => issue.code)).toEqual(["ME106"]);
    expect(await testDb().reservation.count()).toBe(0);
    // 3限前半 (13:30) は、使用止め(1限〜2限)の外
    const allowed = await book([5]);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ notice: "MI101" });
  });

  it("T-BLK-002 終了が開始より前なら ME301。何も保存しない", async () => {
    for (const input of [
      { startPeriod: 2, endPeriod: 1 }, // 同じ日で、終了の時限が前
      { endDate: "2026-11-13" }, // 終了の日が前
    ]) {
      const response = await block(input);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message: MESSAGES.ME301 });
    }
    expect(await blockCount()).toBe(0);
  });

  it("T-BLK-003 始まった時限は指定できない(境界): 10:59 の 2限は可、11:00 の 2限は ME302", async () => {
    const started = await block({
      startDate: "2026-11-10",
      endDate: "2026-11-10",
    });
    expect(started.status).toBe(400); // 10:00 のとき、1限 (09:15) は始まっている
    expect(await started.json()).toEqual({ message: MESSAGES.ME302 });

    at("2026-11-10T10:59");
    const before = await block({
      startDate: "2026-11-10",
      startPeriod: 2,
      endDate: "2026-11-10",
      endPeriod: 2,
    });
    expect(before.status).toBe(200);

    at("2026-11-10T11:00");
    const exact = await block({
      startDate: "2026-11-10",
      startPeriod: 2,
      endDate: "2026-11-10",
      endPeriod: 2,
    });
    expect(exact.status).toBe(400);
    expect(await exact.json()).toEqual({ message: MESSAGES.ME302 });
    expect(await blockCount()).toBe(1);
  });
});

describe("重なる予約・授業は、数えるだけで、変えない(MW301、MW302)", () => {
  it("T-BLK-004 承認済みの予約と重なる: 件数に数える。承認待ちは数えない。予約は変わらない", async () => {
    const approved = await reserve("APPROVED", 1);
    const pending = await reserve("PENDING", 1);
    const response = await block();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notice: "MI301",
      reservations: 1,
      lessons: 0,
    });
    const rows = await testDb().reservation.findMany({
      where: { id: { in: [approved, pending] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [approved]: "APPROVED",
      [pending]: "PENDING",
    });
  });

  it("T-BLK-005 授業と重なる: 件数に数える。休講と、ほかの教室の授業は数えない。授業は変わらない", async () => {
    const db = testDb();
    await db.schoolClass.createMany({
      data: [
        {
          id: CLASS_B,
          name: "デザイン専攻1年",
          homeRoomId: ID.roomHome,
          startYear: 2026,
        },
        {
          id: CLASS_C,
          name: "ビジネス専攻1年",
          homeRoomId: ID.roomHome,
          startYear: 2026,
        },
      ],
    });
    const common = {
      date: textToDateColumn(DAY),
      startMinutes: PERIOD.p1.start,
      endMinutes: PERIOD.p1.end,
      subjectName: "プログラミング",
      kind: "FIXED" as const,
    };
    await db.lesson.createMany({
      data: [
        // 数える: 展示室の授業
        {
          ...common,
          classId: ID.classA,
          roomId: ID.roomFree,
          roomName: ROOM_FREE_NAME,
        },
        // 数えない: 休講
        {
          ...common,
          classId: CLASS_B,
          roomId: ID.roomFree,
          roomName: ROOM_FREE_NAME,
          cancelled: true,
        },
        // 数えない: ほかの教室
        { ...common, classId: CLASS_C, roomId: ID.roomHome, roomName: "101" },
      ],
    });
    const response = await block();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notice: "MI301",
      reservations: 0,
      lessons: 1,
    });
    expect(await db.lesson.count()).toBe(3);
    expect(await db.lesson.count({ where: { cancelled: true } })).toBe(1);
  });

  it("T-BLK-006 承認待ちは、使用止めのあとに承認できない(ME203)", async () => {
    await testDb().monthStatus.create({
      data: { classId: ID.classA, month: "202611", importedAt: new Date() },
    });
    const id = await reserve("PENDING", 1);
    expect((await block()).status).toBe(200); // 設定はできる
    const response = await approve(
      post("/teacher/reservations/approve", { id }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: MESSAGES.ME203 });
    expect(
      (await testDb().reservation.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("PENDING");
  });

  it("T-BLK-011 複数日の範囲の境界: 11/16 の 3限〜11/17 の 2限は、その範囲の予約だけを数える", async () => {
    await reserve("APPROVED", 1, DAY); // 11/16 1限: 範囲の前
    await reserve("APPROVED", 5, DAY); // 11/16 3限: 範囲の最初(数える)
    await reserve("APPROVED", 1, NEXT_DAY); // 11/17 1限: 範囲の中(数える)
    await reserve("APPROVED", 5, NEXT_DAY); // 11/17 3限: 範囲のあと
    const response = await block({
      startPeriod: 3,
      endDate: NEXT_DAY,
      endPeriod: 2,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notice: "MI301",
      reservations: 2,
      lessons: 0,
    });
  });
});

describe("解除する", () => {
  it("T-BLK-007 解除できる(MI302)。行が消え、同じ枠が申請できるようになる", async () => {
    await block();
    const stored = await testDb().roomBlock.findFirstOrThrow();
    const response = await release(stored.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notice: "MI302" });
    expect(await blockCount()).toBe(0);
    session.user = USERS.student;
    const allowed = await book([1]);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ notice: "MI101" });
  });

  it("T-BLK-007b 解除の対象がない・UUID でない文字列は 404(ME902 の文言)。ほかの行は残る", async () => {
    await block();
    for (const bad of [NOT_FOUND_ID, "not-a-uuid", undefined]) {
      const response = await release(bad);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: MESSAGES.ME902 });
    }
    expect(await blockCount()).toBe(1);
  });
});

describe("形の違う入力・教室(R4-10)", () => {
  it("T-BLK-008 無効な教室・存在しない教室は ME109。何も保存しない", async () => {
    await testDb().room.update({
      where: { id: ID.roomFree },
      data: { active: false },
    });
    for (const roomId of [ID.roomFree, NOT_FOUND_ID]) {
      const response = await block({ roomId });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message: MESSAGES.ME109 });
    }
    expect(await blockCount()).toBe(0);
  });

  it("T-BLK-009 形が違う(時限が 5、日付が不正、本文が JSON でない)は 400。何も保存しない", async () => {
    for (const input of [
      { startPeriod: 5 },
      { endPeriod: 0 },
      { startDate: "not-a-date" },
      { endDate: "2026-13-01" },
    ]) {
      const response = await block(input);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message: SYSTEM_ERROR_MESSAGE });
    }
    const broken = await createBlock(request("/teacher/blocks/create", "{"));
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ message: SYSTEM_ERROR_MESSAGE });
    expect(await blockCount()).toBe(0);
  });

  it("T-BLK-010 範囲が長すぎる: 開始から 400 日後(2027-12-21)は可、401 日後(12-22)は 400", async () => {
    const ok = await block({ endDate: "2027-12-21" });
    expect(ok.status).toBe(200);
    const tooLong = await block({ endDate: "2027-12-22" });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ message: SYSTEM_ERROR_MESSAGE });
    expect(await blockCount()).toBe(1);
  });
});
