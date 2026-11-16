import { beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES } from "@/lib/messages";

// S21 教科の追加 + 紐づけ: 教科を作り、選んだクラスへの 3 つの紐づけ (クラスの教科、教科の講師、
// 教科の教室) を、1 回で書く。選べるのは、今年度の有効なクラス、有効な講師・教室だけ。

vi.mock("server-only", () => ({}));
const tx = vi.hoisted(() => ({
  subject: { create: vi.fn() },
  classSubject: { createMany: vi.fn() },
  subjectTeacher: { createMany: vi.fn() },
  subjectRoom: { createMany: vi.fn() },
}));
const db = vi.hoisted(() => ({
  schoolClass: { count: vi.fn() },
  subject: { findFirst: vi.fn(), create: vi.fn() },
  teacher: { findFirst: vi.fn() },
  room: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({ getDb: () => db }));
vi.mock("@/lib/server/queries/export", () => ({
  loadExportSource: vi.fn().mockRejectedValue(new Error("not needed here")),
}));

import { saveMaster } from "@/lib/server/master-edit";

const NOW = new Date("2026-11-10T00:00:00Z"); // 11/10 (Japan): 2026 年度
const CLASS_A = "00000000-0000-4000-8000-0000000000a1";
const CLASS_B = "00000000-0000-4000-8000-0000000000b2";
const TEACHER = "00000000-0000-4000-8000-0000000000c3";
const ROOM = "00000000-0000-4000-8000-0000000000d4";
const SUBJECT = "00000000-0000-4000-8000-0000000000e5";

beforeEach(() => {
  vi.clearAllMocks();
  db.subject.findFirst.mockResolvedValue(null); // 名前は、まだ使われていない
  db.subject.create.mockResolvedValue({});
  db.schoolClass.count.mockResolvedValue(2);
  db.teacher.findFirst.mockResolvedValue({ id: TEACHER });
  db.room.findFirst.mockResolvedValue({ id: ROOM });
  db.$transaction.mockImplementation((work: (t: typeof tx) => unknown) =>
    work(tx),
  );
  tx.subject.create.mockResolvedValue({ id: SUBJECT });
  for (const table of [tx.classSubject, tx.subjectTeacher, tx.subjectRoom]) {
    table.createMany.mockResolvedValue({ count: 2 });
  }
});

describe("教科の追加と一緒に紐づける", () => {
  it("クラスを選ばなければ、教科だけを追加する (紐づけは作らない)", async () => {
    expect(await saveMaster("subjects", { name: "英語A" }, NOW)).toMatchObject({
      kind: "saved",
      notice: "MI501",
    });
    expect(db.subject.create).toHaveBeenCalledWith({ data: { name: "英語A" } });
    expect(db.$transaction).not.toHaveBeenCalled();
    // 空の選びも、同じ
    await saveMaster("subjects", { name: "英語B", classIds: [] }, NOW);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("講師は各担当、教室は未定で、選んだクラスすべてに、3 つの紐づけを 1 回で書く", async () => {
    const result = await saveMaster(
      "subjects",
      {
        name: "英語A",
        classIds: [CLASS_A, CLASS_B],
        teacherId: "each",
        roomId: "none",
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "saved", notice: "MI501" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.subject.create).not.toHaveBeenCalled(); // 教科は、同じ書き込みの中で作る
    expect(tx.subject.create.mock.calls[0][0].data).toEqual({ name: "英語A" });
    expect(tx.classSubject.createMany).toHaveBeenCalledWith({
      data: [
        { classId: CLASS_A, subjectId: SUBJECT },
        { classId: CLASS_B, subjectId: SUBJECT },
      ],
    });
    expect(tx.subjectTeacher.createMany).toHaveBeenCalledWith({
      data: [
        {
          classId: CLASS_A,
          subjectId: SUBJECT,
          teacherId: null,
          teacherKey: "each",
        },
        {
          classId: CLASS_B,
          subjectId: SUBJECT,
          teacherId: null,
          teacherKey: "each",
        },
      ],
    });
    expect(tx.subjectRoom.createMany).toHaveBeenCalledWith({
      data: [
        { classId: CLASS_A, subjectId: SUBJECT, roomId: null, roomKey: "none" },
        { classId: CLASS_B, subjectId: SUBJECT, roomId: null, roomKey: "none" },
      ],
    });
  });

  it("講師と教室を選ぶと、その ID で書く。既定 (指定なし) は、各担当と教室未定", async () => {
    await saveMaster(
      "subjects",
      {
        name: "英語A",
        classIds: [CLASS_A, CLASS_B],
        teacherId: TEACHER,
        roomId: ROOM,
      },
      NOW,
    );
    expect(tx.subjectTeacher.createMany.mock.calls[0][0].data[0]).toEqual({
      classId: CLASS_A,
      subjectId: SUBJECT,
      teacherId: TEACHER,
      teacherKey: TEACHER,
    });
    expect(tx.subjectRoom.createMany.mock.calls[0][0].data[0]).toEqual({
      classId: CLASS_A,
      subjectId: SUBJECT,
      roomId: ROOM,
      roomKey: ROOM,
    });
    // 有効な講師・教室だけを探している
    expect(db.teacher.findFirst).toHaveBeenCalledWith({
      where: { id: TEACHER, active: true },
      select: { id: true },
    });
    expect(db.room.findFirst).toHaveBeenCalledWith({
      where: { id: ROOM, active: true },
      select: { id: true },
    });
    vi.clearAllMocks();
    db.subject.findFirst.mockResolvedValue(null);
    db.schoolClass.count.mockResolvedValue(1);
    db.$transaction.mockImplementation((work: (t: typeof tx) => unknown) =>
      work(tx),
    );
    tx.subject.create.mockResolvedValue({ id: SUBJECT });
    tx.classSubject.createMany.mockResolvedValue({ count: 1 });
    tx.subjectTeacher.createMany.mockResolvedValue({ count: 1 });
    tx.subjectRoom.createMany.mockResolvedValue({ count: 1 });
    await saveMaster("subjects", { name: "英語C", classIds: [CLASS_A] }, NOW);
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
  });

  it("同じクラスを 2 回選んでも、1 回だけ書く", async () => {
    db.schoolClass.count.mockResolvedValue(1);
    await saveMaster(
      "subjects",
      { name: "英語A", classIds: [CLASS_A, CLASS_A] },
      NOW,
    );
    expect(tx.classSubject.createMany.mock.calls[0][0].data).toHaveLength(1);
    // 数える相手も、重複を除いた ID
    expect(db.schoolClass.count.mock.calls[0][0].where.id).toEqual({
      in: [CLASS_A],
    });
  });

  it("クラスは、今年度に存在して有効なものだけ。違えば ME706 で、何も書かない", async () => {
    db.schoolClass.count.mockResolvedValue(1); // 2 つ選んだが、1 つしか見つからない
    const result = await saveMaster(
      "subjects",
      { name: "英語A", classIds: [CLASS_A, CLASS_B] },
      NOW,
    );
    expect(result).toEqual({
      kind: "invalid",
      errors: [{ field: "links", message: MESSAGES.ME706 }],
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.subject.create).not.toHaveBeenCalled();
    const where = db.schoolClass.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ active: true, startYear: { lte: 2026 } });
  });

  it("無効・いない講師と教室、形が違う値は ME706。何も書かない", async () => {
    const cases: Record<string, unknown>[] = [
      { teacherId: "99999999-9999-4999-8999-999999999999" }, // いない講師
      { roomId: "99999999-9999-4999-8999-999999999999" }, // いない教室
      { teacherId: "x' OR 1=1" },
      { roomId: "x'; drop table rooms" },
      { teacherId: 5 },
      { roomId: {} },
      { classIds: ["bad-id"] },
      { classIds: "not-an-array" },
      { classIds: Array.from({ length: 101 }, () => CLASS_A) },
    ];
    for (const extra of cases) {
      db.teacher.findFirst.mockResolvedValue(
        typeof extra.teacherId === "string" &&
          extra.teacherId.startsWith("9999")
          ? null
          : { id: TEACHER },
      );
      db.room.findFirst.mockResolvedValue(
        typeof extra.roomId === "string" && extra.roomId.startsWith("9999")
          ? null
          : { id: ROOM },
      );
      const result = await saveMaster(
        "subjects",
        { name: "英語A", classIds: [CLASS_A, CLASS_B], ...extra },
        NOW,
      );
      expect(result, JSON.stringify(extra)).toMatchObject({
        kind: "invalid",
        errors: [{ field: "links", message: MESSAGES.ME706 }],
      });
    }
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.subject.create).not.toHaveBeenCalled();
  });

  it("名前が使われていれば (ME502)、紐づけも書かない", async () => {
    db.subject.findFirst.mockResolvedValue({ id: SUBJECT });
    const result = await saveMaster(
      "subjects",
      { name: "英語A", classIds: [CLASS_A, CLASS_B] },
      NOW,
    );
    expect(result).toMatchObject({
      kind: "invalid",
      errors: [{ field: "name", message: MESSAGES.ME502 }],
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("書き込みの途中で失敗したら、教科も紐づけも残らない (1 回の書き込み)", async () => {
    tx.subjectRoom.createMany.mockRejectedValue(new Error("boom"));
    await expect(
      saveMaster(
        "subjects",
        { name: "英語A", classIds: [CLASS_A, CLASS_B] },
        NOW,
      ),
    ).rejects.toThrow("boom");
    // 3 つの書き込みは、すべて同じ $transaction の中 (外では、教科を作っていない)
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.subject.create).not.toHaveBeenCalled();
  });

  it("編集では、紐づけを使わない (追加のときだけ)", async () => {
    // 編集の更新は、別の仕組み (版の確認)。ここでは、紐づけの確認も書き込みも行わないこと。
    db.schoolClass.count.mockClear();
    await saveMaster(
      "subjects",
      { id: SUBJECT, version: "bad", name: "英語A", classIds: [CLASS_A] },
      NOW,
    ).catch(() => undefined);
    expect(db.schoolClass.count).not.toHaveBeenCalled();
    expect(tx.classSubject.createMany).not.toHaveBeenCalled();
  });

  it("教科以外 (教室など) には、紐づけを使わない", async () => {
    db.room.findFirst.mockResolvedValue(null);
    await saveMaster(
      "rooms",
      { name: "305", kind: "FREE", classIds: [CLASS_A] },
      NOW,
    ).catch(() => undefined);
    expect(db.schoolClass.count).not.toHaveBeenCalled();
    expect(tx.classSubject.createMany).not.toHaveBeenCalled();
  });
});
