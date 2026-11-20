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
import { ID, USERS, seedBase, type TestRole } from "./support/fixtures";

// 時間割の取り込み (T-IMP) 第 2 回: 時間・締め・年度・仮の時間割・予約や使用止めとの重なり・例外解除・
// 状況の表示(テスト設計書 4-5, 11-8, 11-12)。日付の境目(日本時間の 0:00、26 日、4 月 1 日)が主役。
// 基準の「いま」は、ケースごとに決める(JST)。既定は 2026-11-10(火)10:00(11月分は 25 日まで取り込める)。
// 期待値は、外部設計書とテスト設計書から書いた(tests/cases/timetable-import-2.cases.ts と同じ内容)。

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

import { POST as apply } from "@/app/(main)/admin/import/apply/route";
import { POST as check } from "@/app/(main)/admin/import/check/route";
import { POST as unlock } from "@/app/(main)/admin/import/unlock/route";
import { loadImportRows } from "@/lib/server/queries/admin";
import {
  CLOSURES,
  EMPTY,
  counts,
  csvFile,
  formRequest,
  issueOf,
  monthRows,
  upload,
  type ApplyBody,
  type Upload,
  type View,
} from "./support/timetable-csv";

const CLASS_B = "00000000-0000-4000-8000-000000000011";
/** 全校の休み・行事(seedBase)の 12/9「防災訓練」と同じ名前。 */
const DEC_CLOSURE = { "2026-12-09": "防災訓練" };

const at = (jst: string) => vi.setSystemTime(new Date(`${jst}:00+09:00`));

const runCheck = async (files: Upload[]) => {
  const response = await check(await upload("/admin/import/check", files));
  return { response, view: (await response.json()) as View };
};
const runApply = async (files: Upload[]) => {
  const response = await apply(await upload("/admin/import/apply", files));
  return { response, body: (await response.json()) as ApplyBody };
};
async function runUnlock(classId: string, month: string) {
  const form = new FormData();
  form.append("classId", classId);
  form.append("month", month);
  const response = await unlock(
    await formRequest("/admin/import/unlock", form),
  );
  return { response, body: (await response.json()) as unknown };
}

const nov = () => csvFile("nov.csv", monthRows({ closures: CLOSURES }));
const novWithProvisional = () =>
  csvFile(
    "nov.csv",
    monthRows({
      closures: CLOSURES,
      provisional: { until: "2026-12-11", closures: DEC_CLOSURE },
    }),
  );
const dec = () =>
  csvFile("dec.csv", monthRows({ month: "2026-12", closures: DEC_CLOSURE }));

const dateText = (date: Date) => date.toISOString().slice(0, 10);
const lessonsOf = async (classId = ID.classA) =>
  (
    await testDb().lesson.findMany({
      where: { classId },
      select: { id: true, date: true },
      orderBy: { date: "asc" },
    })
  ).map((lesson) => ({ id: lesson.id, date: dateText(lesson.date) }));
const inDecProvisional = (lesson: { date: string }) =>
  lesson.date >= "2026-12-01" && lesson.date <= "2026-12-11";

async function addClass(
  name: string,
  startYear = 2026,
  endYear?: number,
  active = true,
) {
  await testDb().schoolClass.create({
    data: {
      ...(name === "デザイン専攻1年" ? { id: CLASS_B } : {}),
      name,
      homeRoomId: ID.roomHome,
      startYear,
      endYear: endYear ?? null,
      active,
    },
  });
}

async function reserve(status: "APPROVED" | "PENDING", slot: number) {
  await testDb().reservation.create({
    data: {
      roomId: ID.roomFree,
      date: textToDateColumn("2026-11-16"),
      purpose: "自習",
      status,
      applicantId: USERS.student.id,
      applicantName: USERS.student.name,
      slots: { create: [{ slot }] },
    },
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T10:00");
  await resetDatabase();
  await seedBase();
  await testDb().subject.create({ data: { name: "プログラミング" } });
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

describe("取り込める月(R3-3。日本時間の境目)", () => {
  it("T-IMP-004 過去の月は取り込めない(ME405)", async () => {
    const { view } = await runCheck([
      csvFile("oct.csv", monthRows({ month: "2026-10" })),
    ]);
    expect(issueOf(view.files[0], "ME405")?.message).toBe(
      MESSAGES.ME405(2026, 10),
    );
    expect(view.ok).toBe(false);
  });

  it("T-IMP-005a 締めの前(境界): 11/25 23:59 は、11 月分を取り込める", async () => {
    at("2026-11-25T23:59");
    const { view } = await runCheck([nov()]);
    expect(view.ok).toBe(true);
    expect(view.files[0].verdict).toBe("ok");
  });

  it("T-IMP-005b 締めの境界: 11/26 0:00 は ME407。取り込まれない", async () => {
    at("2026-11-26T00:00");
    const { body } = await runApply([nov()]);
    expect(body.kind).toBe("invalid");
    expect(issueOf(body.view.files[0], "ME407")?.message).toBe(
      MESSAGES.ME407(11),
    );
    expect(await counts()).toEqual(EMPTY);
  });
});

describe("例外解除(R3-5)", () => {
  it("T-IMP-006a 締め後でも、例外解除をすれば、1 回だけ取り込める。取り込むと、自動で締め直す", async () => {
    at("2026-11-27T10:00");
    const locked = await runCheck([nov()]);
    expect(issueOf(locked.view.files[0], "ME407")).toBeDefined();

    const unlocked = await runUnlock(ID.classA, "2026-11");
    expect(unlocked.response.status).toBe(200);
    expect(unlocked.body).toEqual({ ok: true });
    const opened = await testDb().monthStatus.findUniqueOrThrow({
      where: { classId_month: { classId: ID.classA, month: "202611" } },
    });
    expect(opened).toMatchObject({
      exceptionUnlocked: true,
      importedAt: null,
    });

    const { body } = await runApply([nov()]);
    expect(body.kind).toBe("imported");
    const closed = await testDb().monthStatus.findUniqueOrThrow({
      where: { classId_month: { classId: ID.classA, month: "202611" } },
    });
    expect(closed).toMatchObject({
      exceptionUnlocked: false,
      importedAt: new Date("2026-11-27T10:00:00+09:00"),
    });
  });

  it("T-IMP-006b 例外解除は 1 回で終わる: 取り込んだあと、もう一度は ME407", async () => {
    at("2026-11-27T10:00");
    await runUnlock(ID.classA, "2026-11");
    expect((await runApply([nov()])).body.kind).toBe("imported");
    const before = await counts();

    const { body } = await runApply([nov()]);
    expect(body.kind).toBe("invalid");
    expect(issueOf(body.view.files[0], "ME407")?.message).toBe(
      MESSAGES.ME407(11),
    );
    expect(await counts()).toEqual(before);
  });

  it("T-IMP-006c 例外解除できない場合は 400。月の状況に、例外解除は付かない", async () => {
    await addClass("旧クラス", 2024, 2025);
    const old = await testDb().schoolClass.findUniqueOrThrow({
      where: { name: "旧クラス" },
    });
    const refused = async (classId: string, month: string) => {
      const { response, body } = await runUnlock(classId, month);
      expect(response.status).toBe(400);
      expect(body).toEqual({ message: SYSTEM_ERROR_MESSAGE });
    };
    // 25 日以前(まだ締め前)
    await refused(ID.classA, "2026-11");
    at("2026-11-27T10:00");
    // 当月でない月
    await refused(ID.classA, "2026-12");
    // その年度に存在しないクラス
    await refused(old.id, "2026-11");
    // 形が違う入力
    await refused(ID.classA, "2026-13");
    await refused("not-a-uuid", "2026-11");
    expect(await testDb().monthStatus.count()).toBe(0);
  });
});

describe("新しい年度(R3-3。4 月 1 日の境目)", () => {
  it("T-IMP-007a 新しい年度の月は、3 月中は取り込めない(ME406)", async () => {
    for (const now of ["2027-03-15T10:00", "2027-03-31T23:59"]) {
      at(now);
      const { view } = await runCheck([
        csvFile("apr.csv", monthRows({ month: "2027-04" })),
      ]);
      expect(issueOf(view.files[0], "ME406")?.message).toBe(MESSAGES.ME406);
      expect(view.ok).toBe(false);
    }
  });

  it("T-IMP-007b 4/1 0:00 から取り込める", async () => {
    at("2027-04-01T00:00");
    const rows = monthRows({ month: "2027-04" });
    const { body } = await runApply([csvFile("apr.csv", rows)]);
    expect(body.kind).toBe("imported");
    expect(await testDb().lesson.count()).toBe(rows.length);
  });

  it("T-IMP-008 3 月のファイルの 4 月の部分は、取り込まない(MI401)", async () => {
    at("2027-03-10T10:00");
    const rows = monthRows({
      month: "2027-03",
      provisional: { until: "2027-04-11" },
    });
    const marchOnly = monthRows({ month: "2027-03" });
    const { view } = await runCheck([csvFile("mar.csv", rows)]);
    expect(view.ok).toBe(true);
    expect(view.files[0].lessonCount).toBe(marchOnly.length);
    expect(issueOf(view.files[0], "MI401")).toMatchObject({
      level: "info",
      message: MESSAGES.MI401,
    });

    const { body } = await runApply([csvFile("mar.csv", rows)]);
    expect(body.kind).toBe("imported");
    const lessons = await lessonsOf();
    expect(lessons).toHaveLength(marchOnly.length);
    expect(lessons.every((l) => l.date.startsWith("2027-03"))).toBe(true);
    const status = await testDb().monthStatus.findUniqueOrThrow({
      where: { classId_month: { classId: ID.classA, month: "202703" } },
    });
    expect(status.nextLastInputDate).toBeNull();
  });
});

describe("翌月 1〜11 日の仮の時間割(R3-6)", () => {
  it("T-IMP-025a 仮の時間割が保存され、翌月の最終入力日が残る", async () => {
    const { response, body } = await runApply([novWithProvisional()]);
    expect(response.status).toBe(200);
    expect(body.kind).toBe("imported");
    // 読めた授業は、11 月 17 件 + 12/1〜12/11 の 8 件(12/9 は休み・行事)
    expect(body.view.files[0]).toMatchObject({ lessonCount: 25 });
    expect(body.summary).toEqual({
      months: [{ month: "2026-11", classes: 1, lessons: 17 }],
    });
    const lessons = await lessonsOf();
    expect(lessons).toHaveLength(25);
    const provisional = lessons.filter(inDecProvisional);
    expect(provisional).toHaveLength(8);
    expect(provisional.some((l) => l.date === "2026-12-09")).toBe(false);
    const status = await testDb().monthStatus.findUniqueOrThrow({
      where: { classId_month: { classId: ID.classA, month: "202611" } },
    });
    expect(status.nextLastInputDate).toEqual(textToDateColumn("2026-12-11"));
  });

  it("T-IMP-025b 翌月のファイルを取り込むと、仮の時間割は、そのファイルの授業に入れ替わる", async () => {
    await runApply([novWithProvisional()]);
    const old = new Set(
      (await lessonsOf()).filter(inDecProvisional).map((l) => l.id),
    );
    expect(old.size).toBe(8);
    const novStatus = await testDb().monthStatus.findUniqueOrThrow({
      where: { classId_month: { classId: ID.classA, month: "202611" } },
    });

    const { body } = await runApply([dec()]);
    expect(body.kind).toBe("imported");
    const lessons = await lessonsOf();
    const december = lessons.filter((l) => l.date.startsWith("2026-12"));
    // 12 月の平日 23 日 − 休み・行事 1 日(12/9)
    expect(december).toHaveLength(22);
    expect(december.some((l) => old.has(l.id))).toBe(false);
    expect(lessons.filter((l) => l.date.startsWith("2026-11"))).toHaveLength(
      17,
    );
    const decStatus = await testDb().monthStatus.findUniqueOrThrow({
      where: { classId_month: { classId: ID.classA, month: "202612" } },
    });
    expect(decStatus.importedAt).not.toBeNull();
    const after = await testDb().monthStatus.findUniqueOrThrow({
      where: { classId_month: { classId: ID.classA, month: "202611" } },
    });
    expect(after.importedAt).toEqual(novStatus.importedAt);
  });

  it("T-IMP-025c 翌月が取り込み済みなら、仮の時間割は保存しない", async () => {
    await runApply([dec()]);
    const before = await lessonsOf();
    expect(before).toHaveLength(22);

    const { body } = await runApply([novWithProvisional()]);
    expect(body.kind).toBe("imported");
    const lessons = await lessonsOf();
    expect(lessons.filter((l) => l.date.startsWith("2026-11"))).toHaveLength(
      17,
    );
    // 12 月の授業は、12 月のファイルのまま(ID も件数も変わらない)
    const december = lessons.filter((l) => l.date.startsWith("2026-12"));
    expect(december.map((l) => l.id).sort()).toEqual(
      before.map((l) => l.id).sort(),
    );
    const status = await testDb().monthStatus.findUniqueOrThrow({
      where: { classId_month: { classId: ID.classA, month: "202611" } },
    });
    expect(status.nextLastInputDate).toEqual(textToDateColumn("2026-12-11"));
  });
});

describe("予約・使用止め・休み・行事との関係(R4-12、R3-10)", () => {
  it("T-IMP-026 承認済みの予約と重なる授業は、取り込める。MW402(件数)。予約は変わらない", async () => {
    await reserve("APPROVED", 1);
    await reserve("PENDING", 1); // 承認待ちは数えない
    const { view } = await runCheck([nov()]);
    expect(view.ok).toBe(true);
    expect(view.files[0].verdict).toBe("warning");
    expect(issueOf(view.files[0], "MW402")).toMatchObject({
      level: "warning",
      message: MESSAGES.MW402(1),
    });

    const { body } = await runApply([nov()]);
    expect(body.kind).toBe("imported");
    const statuses = await testDb().reservation.findMany({
      select: { status: true },
    });
    expect(statuses.map((r) => r.status).sort()).toEqual([
      "APPROVED",
      "PENDING",
    ]);
  });

  it("T-IMP-027 使用止めと重なる授業は、取り込める。MW403(件数)", async () => {
    await testDb().roomBlock.create({
      data: {
        roomId: ID.roomFree,
        startDate: textToDateColumn("2026-11-16"),
        startPeriod: 1,
        endDate: textToDateColumn("2026-11-16"),
        endPeriod: 1,
        setById: USERS.teacher.id,
        setByName: USERS.teacher.name,
      },
    });
    const { view } = await runCheck([nov()]);
    expect(view.ok).toBe(true);
    expect(issueOf(view.files[0], "MW403")).toMatchObject({
      level: "warning",
      message: MESSAGES.MW403(1),
    });
    expect(issueOf(view.files[0], "MW402")).toBeUndefined();
    expect((await runApply([nov()])).body.kind).toBe("imported");
    expect(await testDb().roomBlock.count()).toBe(1);
  });

  it("T-IMP-034 クラスごとのシステムの行と同じ日付・同じ名称でも、両方保存される", async () => {
    await testDb().closure.create({
      data: {
        startDate: textToDateColumn("2026-11-03"),
        name: "文化の日",
        classId: ID.classA,
        source: "SYSTEM",
      },
    });
    expect((await runApply([nov()])).body.kind).toBe("imported");
    const rows = await testDb().closure.findMany({
      where: { classId: ID.classA, startDate: textToDateColumn("2026-11-03") },
      select: { source: true, name: true },
    });
    expect(rows.map((r) => r.source).sort()).toEqual(["SYSTEM", "TOOL"]);
    expect(rows.every((r) => r.name === "文化の日")).toBe(true);
  });
});

describe("取り込みの状況の表(S20。R3-7)", () => {
  it("T-IMP-033 取込済み・仮の時間割だけ・未取込・例外解除中が、列ごとに分かる。無効・存在しないクラスは出ない", async () => {
    await addClass("デザイン専攻1年");
    await addClass("旧クラス", 2024, 2025);
    await addClass("休止クラス", 2026, undefined, false);
    await runApply([novWithProvisional()]); // システム専攻1年: 11 月は取込済み、12 月は仮の時間割だけ
    await testDb().monthStatus.create({
      data: { classId: CLASS_B, month: "202611", exceptionUnlocked: true },
    });

    const rows = await loadImportRows(["2026-11", "2026-12"]);
    expect(rows.map((r) => r.name).sort()).toEqual(
      ["システム専攻1年", "デザイン専攻1年"].sort(),
    );
    const own = rows.find((r) => r.name === "システム専攻1年")!;
    expect(own.cells[0]).toMatchObject({ imported: "done", unlocked: false });
    expect(own.cells[0].importedText).toContain("に取り込み");
    expect(own.cells[1]).toMatchObject({
      imported: "provisional",
      unlocked: false,
    });
    const other = rows.find((r) => r.name === "デザイン専攻1年")!;
    expect(other.cells[0]).toMatchObject({ imported: "none", unlocked: true });
    expect(other.cells[1]).toMatchObject({ imported: "none", unlocked: false });
  });
});
