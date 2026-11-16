import { beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES } from "@/lib/messages";

// S21 クラスの追加 + 紐づけ: クラスを作り、選んだ教科ごとの 3 つの紐づけ (クラスの教科、教科の講師、
// 教科の教室) を、1 回で書く。選べるのは、有効な教科・講師・教室だけ。

vi.mock("server-only", () => ({}));
const tx = vi.hoisted(() => ({
  schoolClass: { create: vi.fn() },
  classSubject: { createMany: vi.fn() },
  subjectTeacher: { createMany: vi.fn() },
  subjectRoom: { createMany: vi.fn() },
}));
const db = vi.hoisted(() => ({
  schoolClass: { findFirst: vi.fn(), create: vi.fn() },
  subject: { count: vi.fn() },
  teacher: { count: vi.fn() },
  room: { findFirst: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({ getDb: () => db }));
vi.mock("@/lib/server/queries/export", () => ({
  loadExportSource: vi.fn().mockRejectedValue(new Error("not needed here")),
}));

import { saveMaster } from "@/lib/server/master-edit";

const NOW = new Date("2026-11-10T00:00:00Z");
const SUBJECT_A = "00000000-0000-4000-8000-0000000000a1";
const SUBJECT_B = "00000000-0000-4000-8000-0000000000b2";
const TEACHER = "00000000-0000-4000-8000-0000000000c3";
const ROOM = "00000000-0000-4000-8000-0000000000d4";
const HOME = "00000000-0000-4000-8000-0000000000f6";
const CLASS_ID = "00000000-0000-4000-8000-0000000000e5";

const base = {
  name: "医療情報1年",
  homeRoomId: HOME,
  startYear: "2026",
  endYear: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.schoolClass.findFirst.mockResolvedValue(null);
  db.schoolClass.create.mockResolvedValue({});
  db.room.findFirst.mockResolvedValue({ id: HOME });
  db.subject.count.mockResolvedValue(2);
  db.teacher.count.mockResolvedValue(1);
  db.room.count.mockResolvedValue(1);
  db.$transaction.mockImplementation((work: (t: typeof tx) => unknown) =>
    work(tx),
  );
  tx.schoolClass.create.mockResolvedValue({ id: CLASS_ID });
  for (const table of [tx.classSubject, tx.subjectTeacher, tx.subjectRoom]) {
    table.createMany.mockResolvedValue({ count: 2 });
  }
});

describe("クラスの追加と一緒に紐づける", () => {
  it("教科を選ばなければ、クラスだけを追加する", async () => {
    expect(await saveMaster("classes", base, NOW)).toMatchObject({
      kind: "saved",
    });
    expect(db.schoolClass.create).toHaveBeenCalledTimes(1);
    expect(db.$transaction).not.toHaveBeenCalled();
    await saveMaster("classes", { ...base, subjectLinks: [] }, NOW);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("教科ごとの講師・教室で、3 つの紐づけを 1 回で書く (既定は各担当・教室未定)", async () => {
    const result = await saveMaster(
      "classes",
      {
        ...base,
        subjectLinks: [
          { subjectId: SUBJECT_A, teacherId: TEACHER, roomId: ROOM },
          { subjectId: SUBJECT_B, teacherId: "each", roomId: "none" },
        ],
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "saved" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.schoolClass.create).not.toHaveBeenCalled(); // 同じ書き込みの中で作る
    expect(tx.schoolClass.create.mock.calls[0][0].data).toMatchObject({
      name: "医療情報1年",
      homeRoomId: HOME,
      startYear: 2026,
      endYear: null,
    });
    expect(tx.classSubject.createMany).toHaveBeenCalledWith({
      data: [
        { classId: CLASS_ID, subjectId: SUBJECT_A },
        { classId: CLASS_ID, subjectId: SUBJECT_B },
      ],
    });
    expect(tx.subjectTeacher.createMany).toHaveBeenCalledWith({
      data: [
        {
          classId: CLASS_ID,
          subjectId: SUBJECT_A,
          teacherId: TEACHER,
          teacherKey: TEACHER,
        },
        {
          classId: CLASS_ID,
          subjectId: SUBJECT_B,
          teacherId: null,
          teacherKey: "each",
        },
      ],
    });
    expect(tx.subjectRoom.createMany).toHaveBeenCalledWith({
      data: [
        {
          classId: CLASS_ID,
          subjectId: SUBJECT_A,
          roomId: ROOM,
          roomKey: ROOM,
        },
        {
          classId: CLASS_ID,
          subjectId: SUBJECT_B,
          roomId: null,
          roomKey: "none",
        },
      ],
    });
    // 有効なものだけを数えている
    expect(db.subject.count.mock.calls[0][0].where).toMatchObject({
      active: true,
    });
    expect(db.teacher.count.mock.calls[0][0].where).toMatchObject({
      id: { in: [TEACHER] },
      active: true,
    });
  });

  it("指定がなければ、各担当と教室未定", async () => {
    db.subject.count.mockResolvedValue(1);
    await saveMaster(
      "classes",
      { ...base, subjectLinks: [{ subjectId: SUBJECT_A }] },
      NOW,
    );
    expect(tx.subjectTeacher.createMany.mock.calls[0][0].data[0]).toMatchObject(
      {
        teacherId: null,
        teacherKey: "each",
      },
    );
    expect(tx.subjectRoom.createMany.mock.calls[0][0].data[0]).toMatchObject({
      roomId: null,
      roomKey: "none",
    });
    expect(db.teacher.count).not.toHaveBeenCalled();
  });

  it("無効・いない教科/講師/教室、形が違う値、同じ教科の重複は ME706。何も書かない", async () => {
    const link = { subjectId: SUBJECT_A, teacherId: "each", roomId: "none" };
    const cases: { links: unknown; counts?: [number, number, number] }[] = [
      { links: "not-an-array" },
      { links: [null] },
      { links: [{ subjectId: "bad" }] },
      { links: [{ ...link, teacherId: "x' OR 1=1" }] },
      { links: [{ ...link, roomId: 5 }] },
      { links: [link, link] }, // 同じ教科が 2 つ
      { links: Array.from({ length: 101 }, () => link) },
      { links: [link], counts: [0, 0, 0] }, // 無効・いない教科
      { links: [{ ...link, teacherId: TEACHER }], counts: [1, 0, 0] },
      { links: [{ ...link, roomId: ROOM }], counts: [1, 1, 0] },
    ];
    for (const { links, counts } of cases) {
      db.subject.count.mockResolvedValue(counts?.[0] ?? 1);
      db.teacher.count.mockResolvedValue(counts?.[1] ?? 1);
      db.room.count.mockResolvedValue(counts?.[2] ?? 1);
      const result = await saveMaster(
        "classes",
        { ...base, subjectLinks: links },
        NOW,
      );
      expect(result, JSON.stringify(links)).toMatchObject({
        kind: "invalid",
        errors: [{ field: "links", message: MESSAGES.ME706 }],
      });
    }
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.schoolClass.create).not.toHaveBeenCalled();
  });

  it("書き込みの途中で失敗したら、クラスも紐づけも残らない (1 回の書き込み)", async () => {
    db.subject.count.mockResolvedValue(1);
    tx.subjectRoom.createMany.mockRejectedValue(new Error("boom"));
    await expect(
      saveMaster(
        "classes",
        { ...base, subjectLinks: [{ subjectId: SUBJECT_A }] },
        NOW,
      ),
    ).rejects.toThrow("boom");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.schoolClass.create).not.toHaveBeenCalled();
  });

  it("教科以外 (教室) には、紐づけを使わない", async () => {
    await saveMaster(
      "rooms",
      { name: "305", kind: "FREE", subjectLinks: [{ subjectId: SUBJECT_A }] },
      NOW,
    ).catch(() => undefined);
    expect(db.subject.count).not.toHaveBeenCalled();
    expect(tx.classSubject.createMany).not.toHaveBeenCalled();
  });
});
