import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, resetDatabase, testDb } from "./support/db";
import { ID, seedBase } from "./support/fixtures";

// T-SUB: 教科の追加と一緒に紐づける (S21)。本物のデータベースで、教科と 3 つの紐づけが、1 回で入る
// ことと、途中で失敗したら何も残らないこと。「いま」は 2026-11-10 (2026 年度)。

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./support/db");
  return { getDb: () => testDb() };
});

import { saveMaster } from "@/lib/server/master-edit";

const NOW = new Date("2026-11-10T10:00:00+09:00");
const CLASS_B = "00000000-0000-4000-8000-000000000012";
const CLASS_OLD = "00000000-0000-4000-8000-000000000013";

beforeEach(async () => {
  await resetDatabase();
  await seedBase();
  await testDb().schoolClass.createMany({
    data: [
      // 今年度のクラス
      {
        id: CLASS_B,
        name: "医療情報1年",
        homeRoomId: ID.roomHome,
        startYear: 2026,
      },
      // 2025 年度で終わったクラス (今年度には存在しない)
      {
        id: CLASS_OLD,
        name: "旧クラス",
        homeRoomId: ID.roomFree,
        startYear: 2022,
        endYear: 2025,
      },
    ],
  });
});

afterAll(async () => {
  await closeDatabase();
});

describe("教科の追加 + 紐づけ", () => {
  it("T-SUB-001 選んだ 2 クラスに、クラスの教科・教科の講師・教科の教室が、1 回で入る", async () => {
    const result = await saveMaster(
      "subjects",
      {
        name: "英語A",
        classIds: [ID.classA, CLASS_B],
        teacherId: ID.teacher,
        roomId: ID.roomHome,
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "saved", notice: "MI501" });
    const db = testDb();
    const subject = await db.subject.findFirstOrThrow({
      where: { name: "英語A" },
    });
    const classSubjects = await db.classSubject.findMany({
      where: { subjectId: subject.id },
    });
    expect(classSubjects.map((row) => row.classId).sort()).toEqual(
      [ID.classA, CLASS_B].sort(),
    );
    const teachers = await db.subjectTeacher.findMany({
      where: { subjectId: subject.id },
    });
    expect(teachers).toHaveLength(2);
    for (const row of teachers) {
      expect(row).toMatchObject({
        teacherId: ID.teacher,
        teacherKey: ID.teacher,
      });
    }
    const rooms = await db.subjectRoom.findMany({
      where: { subjectId: subject.id },
    });
    expect(rooms).toHaveLength(2);
    for (const row of rooms) {
      expect(row).toMatchObject({ roomId: ID.roomHome, roomKey: ID.roomHome });
    }
  });

  it("T-SUB-002 既定 (各担当・教室未定) は、講師と教室の ID が空で、キーだけが入る", async () => {
    await saveMaster("subjects", { name: "数学", classIds: [ID.classA] }, NOW);
    const db = testDb();
    const subject = await db.subject.findFirstOrThrow({
      where: { name: "数学" },
    });
    expect(
      await db.subjectTeacher.findFirstOrThrow({
        where: { subjectId: subject.id },
      }),
    ).toMatchObject({
      teacherId: null,
      teacherKey: "each",
    });
    expect(
      await db.subjectRoom.findFirstOrThrow({
        where: { subjectId: subject.id },
      }),
    ).toMatchObject({
      roomId: null,
      roomKey: "none",
    });
  });

  it("T-SUB-003 今年度に存在しないクラスを混ぜると、何も入らない (教科も作らない)", async () => {
    const result = await saveMaster(
      "subjects",
      { name: "英語A", classIds: [ID.classA, CLASS_OLD] },
      NOW,
    );
    expect(result).toMatchObject({
      kind: "invalid",
      errors: [{ field: "links" }],
    });
    const db = testDb();
    expect(await db.subject.count()).toBe(0);
    expect(await db.classSubject.count()).toBe(0);
    expect(await db.subjectTeacher.count()).toBe(0);
    expect(await db.subjectRoom.count()).toBe(0);
  });

  it("T-SUB-004 無効にした講師・教室は選べない (何も入らない)", async () => {
    const db = testDb();
    await db.teacher.update({
      where: { id: ID.teacher },
      data: { active: false },
    });
    expect(
      await saveMaster(
        "subjects",
        { name: "英語A", classIds: [ID.classA], teacherId: ID.teacher },
        NOW,
      ),
    ).toMatchObject({ kind: "invalid" });
    await db.teacher.update({
      where: { id: ID.teacher },
      data: { active: true },
    });
    await db.room.update({
      where: { id: ID.roomHome },
      data: { active: false },
    });
    expect(
      await saveMaster(
        "subjects",
        { name: "英語A", classIds: [ID.classA], roomId: ID.roomHome },
        NOW,
      ),
    ).toMatchObject({ kind: "invalid" });
    expect(await db.subject.count()).toBe(0);
    expect(await db.classSubject.count()).toBe(0);
  });

  it("T-SUB-005 同じ名前の教科 (無効も含む) があれば断り、紐づけも入らない", async () => {
    const db = testDb();
    await db.subject.create({ data: { name: "英語A", active: false } });
    const result = await saveMaster(
      "subjects",
      { name: "英語A", classIds: [ID.classA] },
      NOW,
    );
    expect(result).toMatchObject({
      kind: "invalid",
      errors: [{ field: "name" }],
    });
    expect(await db.classSubject.count()).toBe(0);
  });

  it("T-SUB-006 クラスを選ばなければ、教科だけが入る", async () => {
    await saveMaster("subjects", { name: "体育" }, NOW);
    const db = testDb();
    expect(await db.subject.count({ where: { name: "体育" } })).toBe(1);
    expect(await db.classSubject.count()).toBe(0);
  });
});

describe("クラスの追加 + 紐づけ", () => {
  const addClass = {
    name: "新クラス",
    homeRoomId: ID.roomHome,
    startYear: "2026",
    endYear: "",
  };

  it("T-SUB-007 選んだ教科ごとの講師・教室で、クラスと 3 つの紐づけが、1 回で入る", async () => {
    const db = testDb();
    const math = await db.subject.create({ data: { name: "数学" } });
    const english = await db.subject.create({ data: { name: "英語A" } });
    const result = await saveMaster(
      "classes",
      {
        ...addClass,
        subjectLinks: [
          { subjectId: math.id, teacherId: ID.teacher, roomId: ID.roomHome },
          { subjectId: english.id, teacherId: "each", roomId: "none" },
        ],
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "saved" });
    const created = await db.schoolClass.findFirstOrThrow({
      where: { name: "新クラス" },
    });
    expect(
      (await db.classSubject.findMany({ where: { classId: created.id } }))
        .map((row) => row.subjectId)
        .sort(),
    ).toEqual([math.id, english.id].sort());
    expect(
      await db.subjectTeacher.findFirstOrThrow({
        where: { classId: created.id, subjectId: math.id },
      }),
    ).toMatchObject({ teacherId: ID.teacher, teacherKey: ID.teacher });
    expect(
      await db.subjectTeacher.findFirstOrThrow({
        where: { classId: created.id, subjectId: english.id },
      }),
    ).toMatchObject({ teacherId: null, teacherKey: "each" });
    expect(
      await db.subjectRoom.findFirstOrThrow({
        where: { classId: created.id, subjectId: english.id },
      }),
    ).toMatchObject({ roomId: null, roomKey: "none" });
  });

  it("T-SUB-008 無効な教科を混ぜると、クラスも紐づけも入らない", async () => {
    const db = testDb();
    const off = await db.subject.create({
      data: { name: "旧教科", active: false },
    });
    const before = await db.schoolClass.count();
    expect(
      await saveMaster(
        "classes",
        { ...addClass, subjectLinks: [{ subjectId: off.id }] },
        NOW,
      ),
    ).toMatchObject({ kind: "invalid", errors: [{ field: "links" }] });
    expect(await db.schoolClass.count()).toBe(before);
    expect(await db.classSubject.count()).toBe(0);
  });
});
