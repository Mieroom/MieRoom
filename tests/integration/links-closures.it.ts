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
import { buildExport } from "@/lib/domain/master-export";
import { textToDateColumn } from "@/lib/domain/school-date";
import { MESSAGES } from "@/lib/messages";
import { testDb, closeDatabase, resetDatabase } from "./support/db";
import { ID, USERS, seedBase, type TestRole } from "./support/fixtures";

// 紐づけ(S22。T-LNK)と、休み・行事(S23。T-CLS)の追加・編集・削除 (テスト設計書 4-6, 11-5, 11-12): the
// routes, the server functions and a real database. 基準の「いま」は 2026-11-10(火)10:00 JST。
// 本文は、画面(components/screens/link-editor.tsx、closure-editor.tsx)が送る形のまま:
//   紐づけの追加: { tab, classId, ...フォームの項目 }、削除: { tab, classId, subjectId, targetKey }
//   休み・行事の保存: { id, version(編集のときだけ), ...フォームの項目 }、削除: { id }
// 期待値は、外部設計書(S22・S23、規則 R3-10・R4-3・R5-5・R5-6、メッセージ ME501・ME504・ME506・ME519・ME520・
// ME706・ME902・MI501・MW502・MW504)とテスト設計書から書いた(tests/cases/links-closures.cases.ts と同じ内容)。
// 設計書が応答コードまでは決めていない拒否は、「受け付けない(エラーの応答。DB は変わらない)」だけを確かめる。

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
import { POST as closureDelete } from "@/app/(main)/admin/closures/delete/route";
import { POST as closureSave } from "@/app/(main)/admin/closures/save/route";
import { POST as linkAdd } from "@/app/(main)/admin/links/add/route";
import { POST as linkRemove } from "@/app/(main)/admin/links/remove/route";
import {
  loadClosuresOfYear,
  loadLinkChoices,
  loadLinks,
} from "@/lib/server/queries/admin";
import {
  listClosuresForClass,
  listSchoolClosures,
} from "@/lib/server/queries/common";
import { loadExportSource } from "@/lib/server/queries/export";

const HOST = "mieroom.example";
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";

const SUBJECT = {
  prog: "00000000-0000-4000-8000-000000000101",
  math: "00000000-0000-4000-8000-000000000102",
  old: "00000000-0000-4000-8000-000000000103", // 無効
} as const;
const TEACHER = {
  suzuki: "00000000-0000-4000-8000-000000000121",
  retired: "00000000-0000-4000-8000-000000000122", // 無効
} as const;
const ROOM = {
  old: "00000000-0000-4000-8000-000000000141", // 無効
} as const;
const CLASS = {
  other: "00000000-0000-4000-8000-000000000011", // 2026 年度に存在するもう 1 つのクラス
  ended: "00000000-0000-4000-8000-000000000012", // 2024〜2025 年度(2026 年度には存在しない)
  future: "00000000-0000-4000-8000-000000000013", // 2027 年度から
  inactive: "00000000-0000-4000-8000-000000000014", // 無効
  until2026: "00000000-0000-4000-8000-000000000015", // 2026 年度まで
} as const;

const at = (jst: string) => vi.setSystemTime(new Date(`${jst}:00+09:00`));

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

type Answer = {
  notice?: string;
  exportIssues?: number;
  message?: string;
  errors?: { field: string; message: string }[];
  issues?: { code: string }[];
};
const answerOf = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Answer,
});

type Tab = "subjects" | "teachers" | "rooms";

const addLink = async (
  tab: Tab,
  form: Record<string, string>,
  classId: string = ID.classA,
) =>
  answerOf(
    await linkAdd(request("/admin/links/add", { tab, classId, ...form })),
  );
const removeLink = async (
  tab: Tab,
  subjectId: string,
  targetKey: string,
  classId: string = ID.classA,
) =>
  answerOf(
    await linkRemove(
      request("/admin/links/remove", { tab, classId, subjectId, targetKey }),
    ),
  );

type ClosureForm = {
  startDate: string;
  endDate: string;
  name: string;
  classId: string;
};
const closureForm = (over: Partial<ClosureForm> = {}): ClosureForm => ({
  startDate: "2026-11-30",
  endDate: "",
  name: "創立記念日",
  classId: "",
  ...over,
});
const saveClosure = async (
  form: ClosureForm,
  row?: { id: string; version: Date },
) =>
  answerOf(
    await closureSave(
      request("/admin/closures/save", {
        ...(row ? { id: row.id, version: row.version.toISOString() } : {}),
        ...form,
      }),
    ),
  );
const deleteClosure = async (id: string) =>
  answerOf(await closureDelete(request("/admin/closures/delete", { id })));

const db = () => testDb();
const closureByName = (name: string) =>
  db().closure.findFirstOrThrow({ where: { name } });
const closureCount = () => db().closure.count();
const half = (n: number) => "a".repeat(n);

/** 書き出し前の確認(R5-6)の、エラーの番号と件数を、保存のあとで改めて数える(応答の件数と照らす)。 */
async function exportErrors() {
  const result = buildExport(await loadExportSource(2026));
  const errors = result.issues.filter((issue) => issue.level === "error");
  return { count: errors.length, checks: errors.map((issue) => issue.check) };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T10:00");
  await resetDatabase();
  await seedBase();
  const d = db();
  await d.subject.createMany({
    data: [
      { id: SUBJECT.prog, name: "プログラミング" },
      { id: SUBJECT.math, name: "数学" },
      { id: SUBJECT.old, name: "旧教科", active: false },
    ],
  });
  await d.teacher.createMany({
    data: [
      { id: TEACHER.suzuki, displayName: "鈴木" },
      { id: TEACHER.retired, displayName: "退職者", active: false },
    ],
  });
  await d.room.create({
    data: { id: ROOM.old, name: "旧教室", kind: "FREE", active: false },
  });
  await d.schoolClass.createMany({
    data: [
      {
        id: CLASS.other,
        name: "ゲーム専攻1年",
        homeRoomId: ID.roomFree,
        startYear: 2026,
      },
      {
        id: CLASS.ended,
        name: "旧クラス",
        homeRoomId: ID.roomFree,
        startYear: 2024,
        endYear: 2025,
      },
      {
        id: CLASS.future,
        name: "来年度クラス",
        homeRoomId: ID.roomFree,
        startYear: 2027,
      },
      {
        id: CLASS.inactive,
        name: "無効クラス",
        homeRoomId: ID.roomFree,
        startYear: 2026,
        active: false,
      },
      {
        id: CLASS.until2026,
        name: "今年度までクラス",
        homeRoomId: ID.roomFree,
        startYear: 2026,
        endYear: 2026,
      },
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

/** クラスの教科(prog)を、画面を通さずに 1 つ入れておく(教科の講師・教室のタブの前提)。 */
const giveSubject = (subjectId: string = SUBJECT.prog) =>
  db().classSubject.create({ data: { classId: ID.classA, subjectId } });

describe("紐づけ(S22)", () => {
  it("T-LNK-001a クラスの教科を追加・削除できる(MI501)", async () => {
    const added = await addLink("subjects", { subjectId: SUBJECT.prog });
    expect(added.status).toBe(200);
    expect(added.body.notice).toBe("MI501");
    expect(await db().classSubject.count()).toBe(1);
    const rows = await loadLinks("subjects", ID.classA);
    expect(rows.map((row) => row.subject)).toEqual(["プログラミング"]);

    // 画面の削除(MC504 のあと)は、targetKey が空の本文
    const removed = await removeLink("subjects", SUBJECT.prog, "");
    expect(removed.status).toBe(200);
    expect(removed.body.notice).toBe("MI501");
    expect(await db().classSubject.count()).toBe(0);
  });

  it("T-LNK-001b 教科の講師(各担当と、講師)を追加・削除できる。削除は、その 1 行だけ", async () => {
    await giveSubject();
    const each = await addLink("teachers", {
      subjectId: SUBJECT.prog,
      teacherId: "each",
    });
    const named = await addLink("teachers", {
      subjectId: SUBJECT.prog,
      teacherId: ID.teacher,
    });
    expect([each.status, named.status]).toEqual([200, 200]);
    expect([each.body.notice, named.body.notice]).toEqual(["MI501", "MI501"]);
    const rows = await loadLinks("teachers", ID.classA);
    expect(rows.map((row) => row.value).sort()).toEqual(["各担当", "田村"]);

    const removed = await removeLink("teachers", SUBJECT.prog, "each");
    expect(removed.status).toBe(200);
    expect(removed.body.notice).toBe("MI501");
    const left = await loadLinks("teachers", ID.classA);
    expect(left.map((row) => row.value)).toEqual(["田村"]);
  });

  it("T-LNK-001c 教科の教室(ー(教室未定)と、教室)を追加・削除できる。削除は、その 1 行だけ", async () => {
    await giveSubject();
    const none = await addLink("rooms", {
      subjectId: SUBJECT.prog,
      roomId: "none",
    });
    const named = await addLink("rooms", {
      subjectId: SUBJECT.prog,
      roomId: ID.roomFree,
    });
    expect([none.status, named.status]).toEqual([200, 200]);
    const rows = await loadLinks("rooms", ID.classA);
    expect(rows.map((row) => row.value).sort()).toEqual(
      ["ー(教室未定)", "展示室"].sort(),
    );

    const removed = await removeLink("rooms", SUBJECT.prog, ID.roomFree);
    expect(removed.status).toBe(200);
    const left = await loadLinks("rooms", ID.classA);
    expect(left.map((row) => row.value)).toEqual(["ー(教室未定)"]);
  });

  it("T-LNK-001d すでにない行の削除は、ほかの人が先に変更した(ME902)。ほかの行は消えない", async () => {
    await giveSubject();
    await addLink("teachers", { subjectId: SUBJECT.prog, teacherId: "each" });
    const gone = await removeLink("teachers", SUBJECT.prog, ID.teacher);
    expect(gone.status).toBeGreaterThanOrEqual(400);
    expect(gone.body.message).toBe(MESSAGES.ME902);
    expect(await db().subjectTeacher.count()).toBe(1);
    // 存在しないクラス・教科の指定
    const noClass = await removeLink("subjects", SUBJECT.prog, "", MISSING_ID);
    expect(noClass.status).toBeGreaterThanOrEqual(400);
    expect(await db().classSubject.count()).toBe(1);
  });

  it("T-LNK-002a 同じ組み合わせは追加できない(ME506)。「各担当」「ー」も同じ", async () => {
    await giveSubject();
    const cases: [Tab, Record<string, string>][] = [
      ["subjects", { subjectId: SUBJECT.prog }],
      ["teachers", { subjectId: SUBJECT.prog, teacherId: "each" }],
      ["teachers", { subjectId: SUBJECT.prog, teacherId: ID.teacher }],
      ["rooms", { subjectId: SUBJECT.prog, roomId: "none" }],
      ["rooms", { subjectId: SUBJECT.prog, roomId: ID.roomFree }],
    ];
    for (const [tab, form] of cases) {
      if (tab !== "subjects") {
        expect((await addLink(tab, form)).status).toBe(200); // 1 回目は入る
      }
      const again = await addLink(tab, form);
      expect([tab, again.status, again.body.message]).toEqual([
        tab,
        400,
        MESSAGES.ME506,
      ]);
    }
    expect(await db().classSubject.count()).toBe(1);
    expect(await db().subjectTeacher.count()).toBe(2);
    expect(await db().subjectRoom.count()).toBe(2);
  });

  it("T-LNK-003a 無効な教科・講師・教室は選べない(ME706)。追加されない", async () => {
    await giveSubject();
    const subject = await addLink("subjects", { subjectId: SUBJECT.old });
    expect([subject.status, subject.body.message]).toEqual([
      400,
      MESSAGES.ME706,
    ]);
    const teacher = await addLink("teachers", {
      subjectId: SUBJECT.prog,
      teacherId: TEACHER.retired,
    });
    expect([teacher.status, teacher.body.message]).toEqual([
      400,
      MESSAGES.ME706,
    ]);
    const room = await addLink("rooms", {
      subjectId: SUBJECT.prog,
      roomId: ROOM.old,
    });
    expect([room.status, room.body.message]).toEqual([400, MESSAGES.ME706]);
    expect(await db().classSubject.count()).toBe(1);
    expect(await db().subjectTeacher.count()).toBe(0);
    expect(await db().subjectRoom.count()).toBe(0);
  });

  it("T-LNK-003b 存在しない教科・講師・教室も、追加されない(エラーの応答)", async () => {
    await giveSubject();
    const results = [
      await addLink("subjects", { subjectId: MISSING_ID }),
      await addLink("teachers", {
        subjectId: SUBJECT.prog,
        teacherId: MISSING_ID,
      }),
      await addLink("rooms", { subjectId: SUBJECT.prog, roomId: MISSING_ID }),
      await addLink("teachers", { subjectId: SUBJECT.prog, teacherId: "" }),
    ];
    for (const result of results) {
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
    }
    expect(await db().classSubject.count()).toBe(1);
    expect(await db().subjectTeacher.count()).toBe(0);
    expect(await db().subjectRoom.count()).toBe(0);
  });

  it("T-LNK-003c そのクラスの教科でない教科は、教科の講師・教室に選べない(追加されない)", async () => {
    // math は、クラスの教科にしていない
    const teacher = await addLink("teachers", {
      subjectId: SUBJECT.math,
      teacherId: "each",
    });
    const room = await addLink("rooms", {
      subjectId: SUBJECT.math,
      roomId: "none",
    });
    for (const result of [teacher, room]) {
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
    }
    expect(await db().subjectTeacher.count()).toBe(0);
    expect(await db().subjectRoom.count()).toBe(0);
  });

  it("T-LNK-003d 今年度に存在しない・無効なクラスには、追加されない", async () => {
    const targets = [CLASS.ended, CLASS.future, CLASS.inactive, MISSING_ID];
    for (const classId of targets) {
      const result = await addLink(
        "subjects",
        { subjectId: SUBJECT.prog },
        classId,
      );
      expect([classId, result.status >= 400 && result.status < 500]).toEqual([
        classId,
        true,
      ]);
    }
    expect(await db().classSubject.count()).toBe(0);
    // 今年度までのクラス(終了年度 2026)には、追加できる(境目の内側)
    const inside = await addLink(
      "subjects",
      { subjectId: SUBJECT.prog },
      CLASS.until2026,
    );
    expect(inside.status).toBe(200);
  });

  it("T-LNK-004a 保存のあと、書き出し前の確認のエラーの件数が返る(MW502)。保存は止めない", async () => {
    // 教科を足すと、講師の行がない(R5-6 の 3)
    const subject = await addLink("subjects", { subjectId: SUBJECT.prog });
    expect(subject.status).toBe(200);
    let now = await exportErrors();
    expect(subject.body.exportIssues).toBe(now.count);
    expect(now.checks).toContain(3);

    // 各担当を足すと、3 は消える
    const teacher = await addLink("teachers", {
      subjectId: SUBJECT.prog,
      teacherId: "each",
    });
    expect(teacher.status).toBe(200);
    now = await exportErrors();
    expect(teacher.body.exportIssues).toBe(now.count);
    expect(now.checks).not.toContain(3);

    // クラスから教科を外しても、講師の行が残る(R5-6 の 4)。保存はできて、確認に出る
    const removed = await removeLink("subjects", SUBJECT.prog, "");
    expect(removed.status).toBe(200);
    now = await exportErrors();
    expect(removed.body.exportIssues).toBe(now.count);
    expect(now.checks).toContain(4);
    expect(await db().subjectTeacher.count()).toBe(1);
  });

  it("T-LNK-005 クラスの教科のタブでは、講師の行がない教科に印が付く(R5-6 の 3)", async () => {
    await giveSubject(SUBJECT.prog);
    await giveSubject(SUBJECT.math);
    await addLink("teachers", { subjectId: SUBJECT.prog, teacherId: "each" });
    const rows = await loadLinks("subjects", ID.classA);
    const mark = Object.fromEntries(
      rows.map((row) => [row.subject, "missing" in row ? row.missing : null]),
    );
    expect(mark).toEqual({ プログラミング: false, 数学: true });
  });

  it("T-LNK-006 追加の窓で選べるのは、有効なものだけ。教科の講師・教室の教科は、そのクラスの教科", async () => {
    await giveSubject(SUBJECT.prog);
    const choices = await loadLinkChoices(ID.classA);
    // クラスの教科に追加できるのは、まだ取っていない有効な教科
    expect(choices.newSubjects.map((item) => item.name)).toEqual(["数学"]);
    // 教科の講師・教室の教科は、そのクラスの教科
    expect(choices.classSubjects.map((item) => item.name)).toEqual([
      "プログラミング",
    ]);
    expect(choices.teachers.map((item) => item.name).sort()).toEqual(
      ["田村", "鈴木"].sort(),
    );
    expect(choices.rooms.map((item) => item.name).sort()).toEqual(
      ["101", "展示室"].sort(),
    );
  });
});

describe("休み・行事(S23)", () => {
  it("T-CLS-001a 追加・編集・削除できる(MI501)。全校も、クラスごとも", async () => {
    const school = await saveClosure(closureForm());
    expect([school.status, school.body.notice]).toEqual([200, "MI501"]);
    const klass = await saveClosure(
      closureForm({
        name: "クラス行事",
        startDate: "2026-12-14",
        endDate: "2026-12-15",
        classId: ID.classA,
      }),
    );
    expect(klass.status).toBe(200);

    let list = await loadClosuresOfYear(2026, "2026-11-10");
    const byName = (name: string) => list.rows.find((row) => row.name === name);
    expect(byName("創立記念日")).toMatchObject({
      startDate: "2026-11-30",
      endDate: null,
      classId: null,
      editable: true,
    });
    expect(byName("クラス行事")).toMatchObject({
      startDate: "2026-12-14",
      endDate: "2026-12-15",
      classId: ID.classA,
      editable: true,
    });

    // 編集(画面が見た版つき): 名称・日付・対象クラスを変える
    const row = await closureByName("創立記念日");
    const edited = await saveClosure(
      closureForm({
        name: "創立記念日(改)",
        startDate: "2026-12-01",
        endDate: "2026-12-02",
        classId: ID.classA,
      }),
      { id: row.id, version: row.updatedAt },
    );
    expect([edited.status, edited.body.notice]).toEqual([200, "MI501"]);
    list = await loadClosuresOfYear(2026, "2026-11-10");
    expect(list.rows.find((r) => r.id === row.id)).toMatchObject({
      name: "創立記念日(改)",
      startDate: "2026-12-01",
      endDate: "2026-12-02",
      classId: ID.classA,
    });
    expect(await closureCount()).toBe(5); // 全校 3(seed)+ 追加 2

    // 削除
    const removed = await deleteClosure(row.id);
    expect([removed.status, removed.body.notice]).toEqual([200, "MI501"]);
    expect(await closureCount()).toBe(4);
    expect(await db().closure.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("T-CLS-001b 先に変更されていた編集は断る(ME902)。消えた行の編集も同じ", async () => {
    await saveClosure(closureForm());
    const row = await closureByName("創立記念日");
    const stale = new Date(row.updatedAt.getTime() - 60_000);
    const conflict = await saveClosure(closureForm({ name: "上書き" }), {
      id: row.id,
      version: stale,
    });
    expect(conflict.status).toBeGreaterThanOrEqual(400);
    expect(conflict.body.message).toBe(MESSAGES.ME902);
    expect((await closureByName("創立記念日")).id).toBe(row.id);
    expect(await db().closure.count({ where: { name: "上書き" } })).toBe(0);

    await deleteClosure(row.id);
    const gone = await saveClosure(closureForm({ name: "上書き" }), {
      id: row.id,
      version: row.updatedAt,
    });
    expect(gone.status).toBeGreaterThanOrEqual(400);
    expect(gone.body.message).toBe(MESSAGES.ME902);
    expect(await db().closure.count({ where: { name: "上書き" } })).toBe(0);
    const again = await deleteClosure(row.id);
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(again.body.message).toBe(MESSAGES.ME902);
  });

  it("T-CLS-002a 日付が正しくない(ME520)・終了日が開始日より前(ME519)・開始日がない(ME501)は、項目の下に出て、保存しない", async () => {
    const before = await closureCount();
    const field = async (over: Partial<ClosureForm>, name: string) => {
      const result = await saveClosure(closureForm(over));
      expect(result.status).toBe(400);
      return result.body.errors?.find((e) => e.field === name)?.message;
    };
    expect(await field({ startDate: "2026-02-30" }, "startDate")).toBe(
      MESSAGES.ME520,
    );
    expect(await field({ startDate: "あした" }, "startDate")).toBe(
      MESSAGES.ME520,
    );
    expect(await field({ endDate: "2026-13-01" }, "endDate")).toBe(
      MESSAGES.ME520,
    );
    expect(
      await field(
        { startDate: "2026-12-10", endDate: "2026-12-09" },
        "endDate",
      ),
    ).toBe(MESSAGES.ME519);
    expect(await field({ startDate: "" }, "startDate")).toBe(MESSAGES.ME501);
    expect(await closureCount()).toBe(before);
    // 境目: 終了日が開始日と同じ日は、受け付ける(開始日以降)
    const same = await saveClosure(
      closureForm({ startDate: "2026-12-10", endDate: "2026-12-10" }),
    );
    expect(same.status).toBe(200);
  });

  it("T-CLS-002b 名称は必須(ME501)で、20 文字まで(ME504)。全角・半角を問わず 1 文字と数え、前後の空白は取る", async () => {
    const before = await closureCount();
    for (const name of ["", "   ", "　　"]) {
      const result = await saveClosure(closureForm({ name }));
      expect(result.status).toBe(400);
      expect(result.body.errors?.find((e) => e.field === "name")?.message).toBe(
        MESSAGES.ME501,
      );
    }
    const long = await saveClosure(closureForm({ name: half(21) }));
    expect(long.status).toBe(400);
    expect(long.body.errors?.find((e) => e.field === "name")?.message).toBe(
      MESSAGES.ME504(20),
    );
    const longWide = await saveClosure(closureForm({ name: "あ".repeat(21) }));
    expect(longWide.status).toBe(400);
    expect(await closureCount()).toBe(before);

    // 境目: ちょうど 20 文字は可(半角・全角まじり)。前後の空白は、数えず、取って保存する
    const mixed = `${"あ".repeat(10)}${half(10)}`;
    const ok = await saveClosure(closureForm({ name: `  ${mixed}　` }));
    expect(ok.status).toBe(200);
    expect(await db().closure.count({ where: { name: mixed } })).toBe(1);
  });

  it("T-CLS-003 ツールの行は、表示だけ。編集も削除もできない(行は変わらない)", async () => {
    const tool = await db().closure.create({
      data: {
        startDate: textToDateColumn("2026-11-18"),
        name: "ツールの行事",
        classId: ID.classA,
        source: "TOOL",
        targetMonth: "202611",
      },
    });
    const list = await loadClosuresOfYear(2026, "2026-11-10");
    expect(list.rows.find((row) => row.id === tool.id)?.editable).toBe(false);
    expect(list.rows.filter((row) => row.editable)).toHaveLength(3); // seed の 3 件は、システムの行

    const edit = await saveClosure(closureForm({ name: "書き換え" }), {
      id: tool.id,
      version: tool.updatedAt,
    });
    expect(edit.status).toBeGreaterThanOrEqual(400);
    const del = await deleteClosure(tool.id);
    expect(del.status).toBeGreaterThanOrEqual(400);
    const after = await db().closure.findUniqueOrThrow({
      where: { id: tool.id },
    });
    expect(after).toMatchObject({
      name: "ツールの行事",
      source: "TOOL",
      classId: ID.classA,
    });
    expect(after.updatedAt.getTime()).toBe(tool.updatedAt.getTime());
  });

  it("T-CLS-004a 全校の休み・行事が 1 件もない年度は、警告の条件になる(MW504)。クラスごとの行は数えない", async () => {
    const year = async (y: number) =>
      (await loadClosuresOfYear(y, "2026-11-10")).hasSchoolClosure;
    expect(await year(2026)).toBe(true); // 学園祭など(seed)
    expect(await year(2027)).toBe(false); // 2027 年度は 1 件もない
    expect(await year(2025)).toBe(false);

    // クラスごとの行だけでは、全校の行がないまま
    await saveClosure(
      closureForm({
        startDate: "2027-05-10",
        name: "クラス行事",
        classId: ID.classA,
      }),
    );
    expect(await year(2027)).toBe(false);
    // 全校の行を足すと、警告の条件がなくなる
    await saveClosure(
      closureForm({ startDate: "2027-05-11", name: "全校の行事" }),
    );
    expect(await year(2027)).toBe(true);

    // 2026 年度の全校の行を、すべて削除すると、なくなる
    const rows = (await loadClosuresOfYear(2026, "2026-11-10")).rows;
    for (const row of rows) await deleteClosure(row.id);
    expect(await year(2026)).toBe(false);
  });

  it("T-CLS-004b 年度の境目: 3/31 は前の年度、4/1 は次の年度の行として数える", async () => {
    const year = async (y: number) =>
      (await loadClosuresOfYear(y, "2026-11-10")).hasSchoolClosure;
    await saveClosure(
      closureForm({ startDate: "2028-03-31", name: "三月の最終日" }),
    );
    expect(await year(2027)).toBe(true); // 2028-03-31 は 2027 年度
    expect(await year(2028)).toBe(false);
    await saveClosure(
      closureForm({ startDate: "2029-04-01", name: "四月の初日" }),
    );
    expect(await year(2029)).toBe(true); // 2029-04-01 は 2029 年度
    expect(await year(2028)).toBe(false);
  });

  it("T-CLS-005a 対象クラスは、その年度(開始日の年度)に存在する、有効なクラスだけ(ME706)。保存しない", async () => {
    const before = await closureCount();
    const refuse = async (classId: string, startDate: string) => {
      const result = await saveClosure(
        closureForm({ classId, startDate, name: "対象クラスの確認" }),
      );
      expect([classId, startDate, result.status]).toEqual([
        classId,
        startDate,
        400,
      ]);
      expect(
        result.body.errors?.find((e) => e.field === "classId")?.message,
      ).toBe(MESSAGES.ME706);
    };
    await refuse(CLASS.ended, "2026-11-20"); // 終わったクラス
    await refuse(CLASS.future, "2026-11-20"); // まだ始まっていないクラス
    await refuse(CLASS.inactive, "2026-11-20"); // 無効なクラス
    await refuse(MISSING_ID, "2026-11-20"); // ないクラス
    await refuse("not-a-uuid", "2026-11-20");
    expect(await closureCount()).toBe(before);
  });

  it("T-CLS-005b 対象クラスの年度の境目: 終了年度 2026 のクラスは、2027/3/31 まで可、2027/4/1 は不可", async () => {
    const lastDay = await saveClosure(
      closureForm({
        classId: CLASS.until2026,
        startDate: "2027-03-31",
        name: "年度末",
      }),
    );
    expect(lastDay.status).toBe(200);
    const nextDay = await saveClosure(
      closureForm({
        classId: CLASS.until2026,
        startDate: "2027-04-01",
        name: "年度初め",
      }),
    );
    expect(nextDay.status).toBe(400);
    expect(
      nextDay.body.errors?.find((e) => e.field === "classId")?.message,
    ).toBe(MESSAGES.ME706);
    // 2027 年度から始まるクラスは、2027/4/1 から可
    const future = await saveClosure(
      closureForm({
        classId: CLASS.future,
        startDate: "2027-04-01",
        name: "来年度クラスの行事",
      }),
    );
    expect(future.status).toBe(200);
  });

  it("T-CLS-006 クラスごとの行は、そのクラスにだけ出る。営業日の判定(全校の行)には使わない(R3-10)", async () => {
    const saved = await saveClosure(
      closureForm({
        classId: ID.classA,
        startDate: "2026-11-30",
        name: "クラスだけの行事",
      }),
    );
    expect([saved.status, saved.body.notice]).toEqual([200, "MI501"]);
    const row = await closureByName("クラスだけの行事");
    expect(row).toMatchObject({ classId: ID.classA, source: "SYSTEM" });

    const names = async (classId: string | null) =>
      (await listClosuresForClass("2026-11-01", "2026-11-30", classId)).map(
        (item) => item.name,
      );
    expect(await names(ID.classA)).toContain("クラスだけの行事");
    expect(await names(CLASS.other)).not.toContain("クラスだけの行事");
    expect(await names(null)).not.toContain("クラスだけの行事");
    // 全校の行は、どのクラスにも出る
    expect(await names(CLASS.other)).toContain("学園祭");
    // 営業日に使う、全校の行には入らない
    const school = (await listSchoolClosures("2026-11-01", "2026-11-30")).map(
      (item) => item.name,
    );
    expect(school).not.toContain("クラスだけの行事");
    expect(school).toContain("学園祭");
  });

  it("T-CLS-007 全校の行を足す・消すと、申請の締め切りがすぐ動く。クラスごとの行では動かない(R4-3)", async () => {
    // 11/16(月)の枠の締め切りは、前の営業日 11/11(水)12:00(11/12・13 は学園祭、11/14・15 は土日)
    const book = async () => {
      const previous = session.user;
      session.user = USERS.student;
      try {
        return await answerOf(
          await apply(
            request("/reservations/apply", {
              roomId: ID.roomFree,
              date: "2026-11-16",
              slots: [1],
              purpose: "自習",
              note: "",
            }),
          ),
        );
      } finally {
        session.user = previous;
      }
    };
    at("2026-11-11T11:00");
    expect((await book()).status).toBe(200); // 前: 12:00 まで申請できる

    // クラスごとの行(11/11)は、営業日に関係しない
    await saveClosure(
      closureForm({
        startDate: "2026-11-11",
        name: "クラスの休み",
        classId: ID.classA,
      }),
    );
    expect((await book()).status).toBe(200);

    // 全校の行(11/11)を足すと、前の営業日は 11/10(火)になり、11/11 11:00 は締め切りのあと
    await saveClosure(
      closureForm({ startDate: "2026-11-11", name: "全校の休み" }),
    );
    const late = await book();
    expect(late.status).toBe(400);
    expect(late.body.issues?.map((issue) => issue.code)).toEqual(["ME101"]);

    // 消すと、また申請できる
    const row = await closureByName("全校の休み");
    expect((await deleteClosure(row.id)).status).toBe(200);
    expect((await book()).status).toBe(200);
  });
});
