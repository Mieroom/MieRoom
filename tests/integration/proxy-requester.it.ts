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
import { MESSAGES } from "@/lib/messages";
import { closeDatabase, resetDatabase, testDb } from "./support/db";
import { ID, USERS, seedBase, type TestRole } from "./support/fixtures";

// T-PRX: 代理入力の依頼者 (R4-9)。生徒を選ぶと、申請者がその生徒になり、その生徒の「自分の予約」に出る。
// 名前を文字で入れると、依頼者の名前が残る。先生・管理者・先生本人は、選べない。本物のデータベースで。
// 「いま」は 2026-11-10(火) 10:00。11/16(月)の枠を使う (11/12-13 は学園祭)。

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; role: TestRole },
}));
vi.mock("@/lib/server/session", async () => {
  const { hasRole } = await import("./support/session");
  return { getCurrentUser: async () => session.user, hasRole };
});
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./support/db");
  return { getDb: () => testDb() };
});
vi.mock("@/lib/server/env", () => ({
  getEnv: () => ({ INITIAL_ADMIN_EMAIL: "", STUDENT_EMAIL_PATTERN: null }),
}));

import { POST as proxy } from "@/app/(main)/teacher/reservations/proxy/route";
import { POST as search } from "@/app/(main)/teacher/reservations/requesters/route";
import { listMyReservations } from "@/lib/server/queries/reservations";
import { listTeacherRows } from "@/lib/server/queries/review";

const HOST = "mieroom.example";
const NOW = new Date("2026-11-10T10:00:00+09:00");

function post(path: string, body: unknown) {
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

const entry = (extra: Record<string, unknown>) =>
  proxy(
    post("/teacher/reservations/proxy", {
      roomId: ID.roomFree,
      date: "2026-11-16",
      slots: [5, 6],
      purpose: "就活",
      note: "",
      ...extra,
    }),
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDatabase();
  await seedBase();
  // 全クラスの 11 月の時間割が入力済みであること (承認の条件 R4-7)
  await testDb().monthStatus.create({
    data: {
      classId: ID.classA,
      month: "202611",
      importedAt: NOW,
      lastInputDate: textToDateColumn("2026-11-30"),
    },
  });
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

describe("依頼者を文字で入れる", () => {
  it("T-PRX-001 名前が残る。申請者・対応した先生は、入れた先生", async () => {
    const response = await entry({ requesterName: " 大学併修2年 山田 " });
    expect(response.status).toBe(200);
    const row = await testDb().reservation.findFirstOrThrow();
    expect(row).toMatchObject({
      status: "APPROVED",
      proxy: true,
      requesterName: "大学併修2年 山田",
      applicantId: USERS.teacher.id,
      handledById: USERS.teacher.id,
    });
  });

  it("T-PRX-002 空は ME501、21 文字は ME504。何も保存しない", async () => {
    for (const [value, code] of [
      ["  ", "ME501"],
      ["あ".repeat(21), "ME504"],
    ] as const) {
      const response = await entry({ requesterName: value });
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        issues: { code: string; field: string }[];
      };
      expect(body.issues).toMatchObject([{ code, field: "requester" }]);
    }
    expect(await testDb().reservation.count()).toBe(0);
  });
});

describe("登録済みの生徒を選ぶ", () => {
  it("T-PRX-010 申請者がその生徒になり、生徒の「自分の予約」に出る。名前の文字は残らない", async () => {
    const response = await entry({
      requesterId: USERS.student.id,
      requesterName: "別の人",
    });
    expect(response.status).toBe(200);
    const row = await testDb().reservation.findFirstOrThrow();
    expect(row).toMatchObject({
      applicantId: USERS.student.id,
      applicantName: USERS.student.name,
      requesterName: null,
      handledById: USERS.teacher.id,
      proxy: true,
    });
    const mine = await listMyReservations(
      USERS.student.id,
      "2026-11-10",
      NOW,
      1,
    );
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].applicant).toBe(
      `${USERS.student.name}(代理入力: ${USERS.teacher.name})`,
    );
    expect(mine.rows[0].proxy).toBe(true);
    // 入れた先生の「自分の予約」には、出ない (申請者ではないため)
    const teachers = await listMyReservations(
      USERS.teacher.id,
      "2026-11-10",
      NOW,
      1,
    );
    expect(teachers.rows).toHaveLength(0);
  });

  it("T-PRX-011 先生の一覧 (S11) には、依頼者と、入れた先生が出る", async () => {
    await entry({ requesterName: "大学併修2年 山田" });
    const { rows } = await listTeacherRows(
      {
        start: "2026-11-01",
        end: "2026-11-30",
        roomId: null,
        status: null,
        block: null,
      },
      "2026-11-10",
      NOW,
      1,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].applicant).toBe(
      `大学併修2年 山田(代理入力: ${USERS.teacher.name})`,
    );
  });

  it("T-PRX-012 先生・管理者・先生本人・いない人は選べない (ME521)。何も保存しない", async () => {
    const db = testDb();
    // 先生は、講師マスタのメールと一致する人 (先生の判定)
    await db.teacher.update({
      where: { id: ID.teacher },
      data: { email: `${USERS.otherStudent.id}@school.example` },
    });
    await db.adminEmail.create({
      data: { email: `${USERS.admin.id}@school.example` },
    });
    for (const id of [
      USERS.otherStudent.id, // 講師マスタのメール = 先生
      USERS.admin.id, // 管理者
      USERS.teacher.id, // 先生本人
      "nobody",
    ]) {
      const response = await entry({ requesterId: id });
      expect(response.status, id).toBe(400);
      const body = (await response.json()) as {
        issues: { code: string; message: string }[];
      };
      expect(body.issues[0], id).toMatchObject({
        code: "ME521",
        message: MESSAGES.ME521,
      });
    }
    expect(await db.reservation.count()).toBe(0);
  });
});

describe("依頼者の検索", () => {
  it("T-PRX-020 名前に含む生徒だけが、ID と名前で出る。先生・管理者は出ない。メールは出ない", async () => {
    const db = testDb();
    await db.teacher.update({
      where: { id: ID.teacher },
      data: { email: `${USERS.otherStudent.id}@school.example` },
    });
    const response = await search(
      post("/teacher/reservations/requesters", { q: "学生" }),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as { people: { id: string; name: string }[] };
    // 「学生 一郎」(生徒)。「学生 二郎」は講師マスタのメールと一致 = 先生
    expect(body.people).toEqual([
      { id: USERS.student.id, name: USERS.student.name },
    ]);
    expect(text).not.toContain("@");
  });

  it("T-PRX-021 学生は使えない (403)。1 文字は空の一覧", async () => {
    session.user = USERS.student;
    expect(
      (await search(post("/teacher/reservations/requesters", { q: "学生" })))
        .status,
    ).toBe(403);
    session.user = USERS.teacher;
    const short = await search(
      post("/teacher/reservations/requesters", { q: "学" }),
    );
    expect(await short.json()).toEqual({ people: [] });
  });
});
