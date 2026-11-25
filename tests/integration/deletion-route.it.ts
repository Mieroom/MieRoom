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
import { LOGIN_ERROR_MESSAGES, MESSAGES } from "@/lib/messages";
import { testDb, closeDatabase, resetDatabase } from "./support/db";
import { ID, USERS, seedBase, type TestRole } from "./support/fixtures";

// 削除管理(S26。T-DEL、テスト設計書 4-6, 11-7): the route (再ログインの 5 分、名前の入力)、what is shown before
// (影響の表示 MC502)、and a real database. 基準の「いま」は 2026-11-10(火)10:00 JST。
// 本文は、画面が送る形のまま: { kind, id, name }。既存の deletion.it.ts は、サーバーの関数を直接呼んで、
// 教室・クラスを消すと何が一緒に消えるかを確かめている(T-DEL-003/004/007/008)。ここは、入り口を通して、
// 残りのケース(T-DEL-001/002/005/006/009/010/011)を確かめる。
// 期待値は、外部設計書(R5-7、06-3 の S26、メッセージ ME006・ME511・ME512・MC502・MI503)とテスト設計書から
// 書いた(tests/cases/deletion.cases.ts と同じ内容)。

vi.mock("server-only", () => ({}));
type TestUser = { id: string; name: string; role: TestRole };
const session = vi.hoisted(() => ({
  user: null as null | TestUser,
  fresh: true,
}));
vi.mock("@/lib/server/session", async () => {
  const { hasRole } = await import("./support/session");
  return {
    getCurrentUser: async () => session.user,
    hasRole,
    hasFreshSession: async () => session.fresh,
  };
});
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./support/db");
  return { getDb: () => testDb() };
});

import { POST as run } from "@/app/(main)/admin/delete/run/route";
import { loadDeletionRows } from "@/lib/server/queries/deletion";

const HOST = "mieroom.example";
const NOW = new Date("2026-11-10T10:00:00+09:00");
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";
const date = textToDateColumn;

const OLD = {
  room: "00000000-0000-4000-8000-0000000000a1",
  classId: "00000000-0000-4000-8000-0000000000b1",
  subject: "00000000-0000-4000-8000-0000000000c1",
  teacher: "00000000-0000-4000-8000-0000000000d1",
} as const;
type Kind = "classes" | "subjects" | "rooms" | "teachers";
const KINDS: Kind[] = ["classes", "subjects", "rooms", "teachers"];
const OLD_NAME: Record<Kind, string> = {
  classes: "旧クラス",
  subjects: "旧教科",
  rooms: "旧教室",
  teachers: "退職者",
};
const OLD_ID: Record<Kind, string> = {
  classes: OLD.classId,
  subjects: OLD.subject,
  rooms: OLD.room,
  teachers: OLD.teacher,
};

const at = (jst: string) => vi.setSystemTime(new Date(`${jst}:00+09:00`));

function request(body: unknown) {
  return new NextRequest(`https://${HOST}/admin/delete/run`, {
    method: "POST",
    headers: {
      host: HOST,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
type Answer = { notice?: string; message?: string; reauth?: boolean };
const remove = async (kind: unknown, id: unknown, name: unknown) => {
  const response = await run(request({ kind, id, name }));
  return { status: response.status, body: (await response.json()) as Answer };
};

const db = () => testDb();
const exists = async (kind: Kind, id: string) =>
  kind === "classes"
    ? (await db().schoolClass.count({ where: { id } })) === 1
    : kind === "subjects"
      ? (await db().subject.count({ where: { id } })) === 1
      : kind === "rooms"
        ? (await db().room.count({ where: { id } })) === 1
        : (await db().teacher.count({ where: { id } })) === 1;

/** 無効な、使われていない 4 種類(クラス・教科・教室・講師)を作る。ホームルーム教室は、使わない別の教室。 */
async function makeOldOnes() {
  await db().room.create({
    data: { id: OLD.room, name: OLD_NAME.rooms, kind: "FREE", active: false },
  });
  await db().schoolClass.create({
    data: {
      id: OLD.classId,
      name: OLD_NAME.classes,
      homeRoomId: ID.roomFree, // 旧教室ではない(旧教室は、ホームルーム教室として使わない)
      startYear: 2024,
      endYear: 2025,
      active: false,
    },
  });
  await db().subject.create({
    data: { id: OLD.subject, name: OLD_NAME.subjects, active: false },
  });
  await db().teacher.create({
    data: { id: OLD.teacher, displayName: OLD_NAME.teachers, active: false },
  });
}

let startMinutes = 500;
/** 授業を 1 つ足す(クラス・日付・開始が重ならないように、開始をずらす)。 */
const lesson = (day: string, over: Record<string, unknown> = {}) =>
  db().lesson.create({
    data: {
      classId: ID.classA,
      date: date(day),
      startMinutes: (startMinutes += 1),
      endMinutes: startMinutes + 90,
      subjectName: "プログラミング",
      kind: "FIXED",
      ...over,
    },
  });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T10:00");
  await resetDatabase();
  await seedBase();
  session.user = USERS.admin;
  session.fresh = true;
  startMinutes = 500;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDatabase();
});

describe("削除できる条件と、削除の動き", () => {
  it("T-DEL-001 有効のままは削除できない(ME512「有効になっています」)。行は残る", async () => {
    const active: Record<Kind, [string, string]> = {
      classes: [ID.classA, "システム専攻1年"],
      rooms: [ID.roomFree, "展示室"],
      teachers: [ID.teacher, "田村"],
      subjects: ["", ""],
    };
    const subject = await db().subject.create({ data: { name: "数学" } });
    active.subjects = [subject.id, "数学"];
    for (const kind of KINDS) {
      const [id, name] = active[kind];
      const result = await remove(kind, id, name);
      expect([kind, result.status, result.body.message]).toEqual([
        kind,
        409,
        MESSAGES.ME512("有効になっています。先に無効にしてください"),
      ]);
      expect(await exists(kind, id), kind).toBe(true);
    }
  });

  it("T-DEL-002 無効で、名前が一致し、使われていなければ削除できる(MI503)。一覧から消える", async () => {
    await makeOldOnes();
    for (const kind of KINDS) {
      const before = await loadDeletionRows(kind, NOW);
      expect(
        before.map((row) => row.name),
        kind,
      ).toEqual([OLD_NAME[kind]]);
      expect(before[0].canDelete, kind).toBe(true);

      const result = await remove(kind, OLD_ID[kind], OLD_NAME[kind]);
      expect([kind, result.status, result.body.notice]).toEqual([
        kind,
        200,
        "MI503",
      ]);
      expect(await exists(kind, OLD_ID[kind]), kind).toBe(false);
      expect(await loadDeletionRows(kind, NOW), kind).toEqual([]);
    }
  });

  it("T-DEL-003b 名前は、前後の空白だけ除いて、一字違わず一致したときだけ通る(ME511)。行は残る", async () => {
    await makeOldOnes();
    await db().room.update({
      where: { id: OLD.room },
      data: { name: "Room1" },
    });
    for (const typed of [
      "room1",
      "ＲＯＯＭ１",
      "Room 1",
      "Room",
      "",
      "  ",
      1,
      null,
    ]) {
      const result = await remove("rooms", OLD.room, typed);
      expect([String(typed), result.status, result.body.message]).toEqual([
        String(typed),
        409,
        MESSAGES.ME511,
      ]);
    }
    expect(await exists("rooms", OLD.room)).toBe(true);
    // 前後の空白(半角・全角ではなく、取り除く対象の空白)は、取って比べる
    const trimmed = await remove("rooms", OLD.room, "  Room1  ");
    expect([trimmed.status, trimmed.body.notice]).toEqual([200, "MI503"]);
    expect(await exists("rooms", OLD.room)).toBe(false);
  });

  it("T-DEL-005 5 分以内にログインし直していなければ、403 と ME006(再ログインへ)。何も消えない。直後は消せる", async () => {
    await makeOldOnes();
    session.fresh = false;
    for (const kind of KINDS) {
      const result = await remove(kind, OLD_ID[kind], OLD_NAME[kind]);
      expect([kind, result.status, result.body.message]).toEqual([
        kind,
        403,
        LOGIN_ERROR_MESSAGES.ME006,
      ]);
      expect(result.body.reauth, kind).toBe(true);
      expect(await exists(kind, OLD_ID[kind]), kind).toBe(true);
    }
    session.fresh = true;
    const result = await remove("rooms", OLD.room, OLD_NAME.rooms);
    expect([result.status, result.body.notice]).toEqual([200, "MI503"]);
  });

  it("T-DEL-012 種類・ID・本文が正しくないときは、削除しない(エラーの応答。500 ではない)", async () => {
    await makeOldOnes();
    for (const [kind, id] of [
      ["unknown", OLD.room],
      [undefined, OLD.room],
      ["rooms", "not-a-uuid"],
      ["rooms", undefined],
      ["rooms", MISSING_ID],
      [["rooms"], OLD.room],
    ] as const) {
      const result = await remove(kind, id, "旧教室");
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
    }
    expect(await exists("rooms", OLD.room)).toBe(true);
    // 本文が JSON でない
    const broken = await run(
      new NextRequest(`https://${HOST}/admin/delete/run`, {
        method: "POST",
        headers: {
          host: HOST,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
        body: "{broken",
      }),
    );
    expect(broken.status).toBe(400);
    expect(await exists("rooms", OLD.room)).toBe(true);
  });
});

describe("削除したときの影響の表示(S26。MC502 の件数)", () => {
  it("T-DEL-006 影響の件数: クラス・教科・講師・教室ごとに、消えるもの・名前だけ残るものを数えて出す", async () => {
    await makeOldOnes();
    // 過去の授業(今日より前): クラス 3、教科 2、教室 2、講師 2
    await lesson("2026-11-02", { classId: OLD.classId });
    await lesson("2026-11-03", { classId: OLD.classId });
    await lesson("2026-11-04", { classId: OLD.classId });
    await lesson("2026-11-05", {
      subjectId: OLD.subject,
      subjectName: "旧教科",
    });
    await lesson("2026-11-06", {
      subjectId: OLD.subject,
      subjectName: "旧教科",
    });
    await lesson("2026-11-02", { roomId: OLD.room, roomName: "旧教室" });
    await lesson("2026-11-03", { roomId: OLD.room, roomName: "旧教室" });
    for (const day of ["2026-11-04", "2026-11-05"]) {
      const l = await lesson(day);
      await db().lessonTeacher.create({
        data: { lessonId: l.id, teacherName: "退職者", teacherId: OLD.teacher },
      });
    }
    // クラス: 取り込みの状況 1、クラスごとの休み・行事 2
    await db().monthStatus.create({
      data: { classId: OLD.classId, month: "202611", importedAt: NOW },
    });
    await db().closure.createMany({
      data: [
        {
          startDate: date("2026-11-20"),
          name: "行事A",
          classId: OLD.classId,
          source: "SYSTEM",
        },
        {
          startDate: date("2026-11-21"),
          name: "行事B",
          classId: OLD.classId,
          source: "SYSTEM",
        },
      ],
    });
    // 教室: 終わった予約 1、終わった使用止め 1、受信機 2
    await db().reservation.create({
      data: {
        roomId: OLD.room,
        date: date("2026-11-02"),
        purpose: "自習",
        status: "APPROVED",
        applicantId: USERS.student.id,
        applicantName: USERS.student.name,
        slots: { create: [{ slot: 1 }] },
      },
    });
    await db().roomBlock.create({
      data: {
        roomId: OLD.room,
        startDate: date("2026-11-02"),
        startPeriod: 1,
        endDate: date("2026-11-03"),
        endPeriod: 4,
        setByName: USERS.teacher.name,
      },
    });
    await db().receiver.createMany({
      data: [
        { receiverId: "304", roomId: OLD.room },
        { receiverId: "305", roomId: OLD.room },
      ],
    });
    // 講師: タグと位置
    await db().teacher.update({
      where: { id: OLD.teacher },
      data: { tagId: "55" },
    });
    await db().location.create({
      data: {
        teacherId: OLD.teacher,
        roomId: ID.roomFree,
        status: "DETECTED",
        lastEventId: "00000000-0000-4000-8000-0000000000e2",
        lastOccurredAt: new Date("2026-11-10T09:50:00+09:00"),
        updatedAt: new Date("2026-11-10T09:50:00+09:00"),
      },
    });

    const impacts = async (kind: Kind) => {
      const rows = await loadDeletionRows(kind, NOW);
      expect(rows, kind).toHaveLength(1);
      expect(rows[0].canDelete, kind).toBe(true);
      expect(rows[0].reasons, kind).toEqual([]);
      return rows[0].impacts.join(" / ");
    };
    const classes = await impacts("classes");
    expect(classes).toContain("過去の授業3件");
    expect(classes).toContain("取り込みの状況1件");
    expect(classes).toContain("クラスごとの休み・行事2件");
    const subjects = await impacts("subjects");
    expect(subjects).toContain("過去の授業2件");
    expect(subjects).toContain("名前だけ残る");
    const teachers = await impacts("teachers");
    expect(teachers).toContain("過去の授業2件");
    expect(teachers).toContain("名前だけ残る");
    expect(teachers).toContain("位置");
    expect(teachers).toContain("タグ");
    const rooms = await impacts("rooms");
    expect(rooms).toContain("過去の授業2件");
    expect(rooms).toContain("名前だけ残る");
    expect(rooms).toContain("終わった予約1件");
    expect(rooms).toContain("終わった使用止め1件");
    expect(rooms).toContain("受信機の登録2件");
  });
});

describe("講師・教科の削除(R5-7)", () => {
  it("T-DEL-009 講師を削除: 位置とタグも消える。過去の授業は、講師の名前だけ残り、ID は空になる。タグは、ほかの講師が使える", async () => {
    await makeOldOnes();
    await db().teacher.update({
      where: { id: OLD.teacher },
      data: { tagId: "55" },
    });
    await db().location.create({
      data: {
        teacherId: OLD.teacher,
        roomId: ID.roomFree,
        status: "DETECTED",
        lastEventId: "00000000-0000-4000-8000-0000000000e3",
        lastOccurredAt: new Date("2026-11-10T09:50:00+09:00"),
        updatedAt: new Date("2026-11-10T09:50:00+09:00"),
      },
    });
    const past = await lesson("2026-11-02");
    await db().lessonTeacher.create({
      data: {
        lessonId: past.id,
        teacherName: "退職者",
        teacherId: OLD.teacher,
      },
    });

    const result = await remove("teachers", OLD.teacher, "退職者");
    expect([result.status, result.body.notice]).toEqual([200, "MI503"]);
    expect(await exists("teachers", OLD.teacher)).toBe(false);
    expect(await db().location.count()).toBe(0);
    // 過去の授業は残る。講師の名前は残り、ID だけが空
    expect(await db().lesson.count({ where: { id: past.id } })).toBe(1);
    const row = await db().lessonTeacher.findFirstOrThrow();
    expect(row).toMatchObject({ teacherName: "退職者", teacherId: null });
    // タグ 55 は空く
    await db().teacher.create({
      data: { displayName: "新しい先生", tagId: "55" },
    });
  });

  it("T-DEL-010 教科を削除: 過去の授業は教科の名前だけ残る。紐づけが残っていれば、削除できない(ME512「紐づけ N 件」)", async () => {
    await makeOldOnes();
    const past = await lesson("2026-11-02", {
      subjectId: OLD.subject,
      subjectName: "旧教科",
    });
    await db().classSubject.create({
      data: { classId: ID.classA, subjectId: OLD.subject },
    });

    const refused = await remove("subjects", OLD.subject, "旧教科");
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe(MESSAGES.ME512("紐づけ1件"));
    expect(await exists("subjects", OLD.subject)).toBe(true);

    await db().classSubject.deleteMany({});
    const result = await remove("subjects", OLD.subject, "旧教科");
    expect([result.status, result.body.notice]).toEqual([200, "MI503"]);
    expect(await exists("subjects", OLD.subject)).toBe(false);
    const after = await db().lesson.findUniqueOrThrow({
      where: { id: past.id },
    });
    expect(after).toMatchObject({ subjectId: null, subjectName: "旧教科" });
  });
});

describe("使われている理由(R5-7 の 3)", () => {
  it("T-DEL-011a 今日以降の授業があれば、教室・教科・講師・クラスは削除できない(ME512「今日以降の授業」)。昨日までの授業は、止めない", async () => {
    await makeOldOnes();
    // 昨日(11/9)の授業は、止めない
    await lesson("2026-11-09", { roomId: OLD.room, roomName: "旧教室" });
    await lesson("2026-11-09", {
      subjectId: OLD.subject,
      subjectName: "旧教科",
    });
    const yesterday = await lesson("2026-11-09", { classId: OLD.classId });
    const past = await lesson("2026-11-09");
    await db().lessonTeacher.create({
      data: {
        lessonId: past.id,
        teacherName: "退職者",
        teacherId: OLD.teacher,
      },
    });
    for (const kind of ["rooms", "subjects", "teachers"] as const) {
      expect((await loadDeletionRows(kind, NOW))[0].canDelete, kind).toBe(true);
    }
    expect((await loadDeletionRows("classes", NOW))[0].canDelete).toBe(true);
    expect(yesterday.id).toBeTruthy();

    // 今日(11/10)の授業から、止める
    await lesson("2026-11-10", { roomId: OLD.room, roomName: "旧教室" });
    await lesson("2026-11-10", {
      subjectId: OLD.subject,
      subjectName: "旧教科",
    });
    await lesson("2026-11-10", { classId: OLD.classId });
    const today = await lesson("2026-11-10");
    await db().lessonTeacher.create({
      data: {
        lessonId: today.id,
        teacherName: "退職者",
        teacherId: OLD.teacher,
      },
    });
    for (const kind of KINDS) {
      const result = await remove(kind, OLD_ID[kind], OLD_NAME[kind]);
      expect([kind, result.status]).toEqual([kind, 409]);
      expect(result.body.message, kind).toContain("今日以降の授業1件");
      expect(await exists(kind, OLD_ID[kind]), kind).toBe(true);
      const row = (await loadDeletionRows(kind, NOW))[0];
      expect(row.canDelete, kind).toBe(false);
      expect(row.reasons.join("、"), kind).toContain("今日以降の授業1件");
      // 今日の授業は「今日以降」で、「過去の授業」には入らない(昨日までの 1 件だけが過去)
      expect(row.impacts.join(" / "), kind).toContain("過去の授業1件");
    }
  });

  it("T-DEL-011b 紐づけ(教科・講師・教室)が残っていれば、削除できない(ME512「紐づけ」)。クラスは、紐づけだけなら削除できて、紐づけも一緒に消える", async () => {
    await makeOldOnes();
    await db().classSubject.create({
      data: { classId: ID.classA, subjectId: OLD.subject },
    });
    await db().subjectTeacher.create({
      data: {
        classId: ID.classA,
        subjectId: OLD.subject,
        teacherId: OLD.teacher,
        teacherKey: OLD.teacher,
      },
    });
    await db().subjectRoom.create({
      data: {
        classId: ID.classA,
        subjectId: OLD.subject,
        roomId: OLD.room,
        roomKey: OLD.room,
      },
    });
    for (const kind of ["subjects", "teachers", "rooms"] as const) {
      const result = await remove(kind, OLD_ID[kind], OLD_NAME[kind]);
      expect([kind, result.status]).toEqual([kind, 409]);
      expect(result.body.message, kind).toContain("紐づけ");
      expect(await exists(kind, OLD_ID[kind]), kind).toBe(true);
    }
    // クラスの紐づけ: クラスと一緒に消える
    await db().classSubject.create({
      data: { classId: OLD.classId, subjectId: OLD.subject },
    });
    await db().subjectTeacher.create({
      data: {
        classId: OLD.classId,
        subjectId: OLD.subject,
        teacherId: null,
        teacherKey: "each",
      },
    });
    const klass = await remove("classes", OLD.classId, "旧クラス");
    expect([klass.status, klass.body.notice]).toEqual([200, "MI503"]);
    expect(
      await db().classSubject.count({ where: { classId: OLD.classId } }),
    ).toBe(0);
    expect(
      await db().subjectTeacher.count({ where: { classId: OLD.classId } }),
    ).toBe(0);
  });
});
