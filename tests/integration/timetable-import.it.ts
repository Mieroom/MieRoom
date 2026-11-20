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
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} from "@/lib/domain/import-limits";
import { textToDateColumn } from "@/lib/domain/school-date";
import { MESSAGES } from "@/lib/messages";
import { testDb, closeDatabase, resetDatabase } from "./support/db";
import {
  ID,
  ROOM_FREE_NAME,
  USERS,
  seedBase,
  type TestRole,
} from "./support/fixtures";

// 時間割の取り込み (T-IMP): the routes (確認する・取り込む), the server functions and a real database
// (テスト設計書 4-5, 11-8). 第 1 回: 本物の DB や入り口を通して初めて分かること(マスタとの突き合わせ、
// 全部成功か全部なし、取り込み直し、上限)。CSV の細かい形式の検査は、単体テストにある。
// The clock is fixed to Japan time: 2026-11-10 (火) 10:00 (11月分は 25 日まで取り込める)。
// 期待値は、外部設計書とテスト設計書から書いた(tests/cases/timetable-import.cases.ts と同じ内容)。

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

const HOST = "mieroom.example";
const CLASS_NAME = "システム専攻1年";
const CLASS_B = "00000000-0000-4000-8000-000000000011";

const at = (jst: string) => vi.setSystemTime(new Date(`${jst}:00+09:00`));

// ---- 取込用 CSV を作る補助 --------------------------------------------------------------

const HEAD = [
  "クラス",
  "日付",
  "曜日",
  "時限",
  "開始",
  "終了",
  "科目",
  "講師",
  "教室",
  "区分",
  "当月の最終入力日",
  "翌月の最終入力日",
  "対象年月",
  "ホームルーム教室",
];
type Cells = Record<string, string>;

/** 11 月の休み・行事。11/12・13 と 11/23 は、全校の休み・行事(seedBase)と同じ名前。 */
const CLOSURES: Record<string, string> = {
  "2026-11-03": "文化の日",
  "2026-11-12": "学園祭",
  "2026-11-13": "学園祭",
  "2026-11-23": "勤労感謝の日",
};

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 2026 年 11 月の、正しい 1 か月分。平日 21 日のうち、休み・行事の 4 日を除く 17 日に、1限の授業
 * (田村・展示室・固定)。最初の授業の行は、2 行目(11/2)。
 */
function monthCells(
  closures: Record<string, string> = CLOSURES,
  className = CLASS_NAME,
): Cells[] {
  const rows: Cells[] = [];
  for (let day = 1; day <= 30; day++) {
    const date = `2026-11-${String(day).padStart(2, "0")}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const common = {
      クラス: className,
      日付: date,
      曜日: WEEKDAY[weekday],
      当月の最終入力日: "2026-11-30",
      翌月の最終入力日: "",
      対象年月: "202611",
      ホームルーム教室: "101",
    };
    const closure = closures[date];
    rows.push(
      closure === undefined
        ? {
            ...common,
            時限: "1限",
            開始: "9:15",
            終了: "10:45",
            科目: "プログラミング",
            講師: "田村",
            教室: ROOM_FREE_NAME,
            区分: "固定",
          }
        : {
            ...common,
            時限: "",
            開始: "",
            終了: "",
            科目: closure,
            講師: "",
            教室: "",
            区分: "休み・行事",
          },
    );
  }
  return rows;
}

const FIRST_LESSON_LINE = 2; // 見出しが 1 行目。最初の行は 11/2(月)の授業

function csvText(rows: Cells[], head: string[] = HEAD): string {
  const lines = [head.join(",")];
  for (const row of rows) lines.push(head.map((h) => row[h] ?? "").join(","));
  return `${lines.join("\r\n")}\r\n`;
}

type Upload = { name: string; bytes: Uint8Array };
const utf8 = (text: string) => new TextEncoder().encode(text);
const csvFile = (name: string, rows: Cells[], head?: string[]): Upload => ({
  name,
  bytes: utf8(csvText(rows, head)),
});

/** A request the way a browser sends it: the body is already encoded and its length is known. */
async function upload(path: string, files: Upload[]) {
  const form = new FormData();
  for (const file of files) {
    form.append(
      "files",
      new File([file.bytes as BlobPart], file.name, { type: "text/csv" }),
    );
  }
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  return new NextRequest(`https://${HOST}${path}`, {
    method: "POST",
    body,
    headers: {
      host: HOST,
      "sec-fetch-site": "same-origin",
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(body.length),
    },
  });
}

type Issue = {
  level: string;
  code: string;
  line: number | null;
  message: string;
};
type FileView = {
  name: string;
  className: string | null;
  month: string | null;
  lessonCount: number;
  closureCount: number;
  verdict: string;
  issues: Issue[];
};
type View = {
  files: FileView[];
  general: Issue[];
  ok: boolean;
  lostChanges: number;
};
type ApplyBody = {
  kind: "imported" | "invalid";
  view: View;
  summary?: { months: { month: string; classes: number; lessons: number }[] };
};

const runCheck = async (files: Upload[]) => {
  const response = await check(await upload("/admin/import/check", files));
  return { response, view: (await response.json()) as View };
};
const runApply = async (files: Upload[]) => {
  const response = await apply(await upload("/admin/import/apply", files));
  return { response, body: (await response.json()) as ApplyBody };
};
const issueOf = (file: FileView, code: string) =>
  file.issues.find((issue) => issue.code === code);

async function counts() {
  const db = testDb();
  return {
    lessons: await db.lesson.count(),
    lessonTeachers: await db.lessonTeacher.count(),
    months: await db.monthStatus.count(),
    toolClosures: await db.closure.count({ where: { source: "TOOL" } }),
  };
}
const EMPTY = { lessons: 0, lessonTeachers: 0, months: 0, toolClosures: 0 };

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

async function addClass(name: string, startYear = 2026, endYear?: number) {
  await testDb().schoolClass.create({
    data: {
      ...(name === "デザイン専攻1年" ? { id: CLASS_B } : {}),
      name,
      homeRoomId: ID.roomHome,
      startYear,
      endYear: endYear ?? null,
    },
  });
}

describe("取り込む・確認する(R3-2)", () => {
  it("T-IMP-001 正常に取り込める(MI402 の元の件数)。授業・講師・月の状況・休み・行事が DB に入る", async () => {
    const { response, body } = await runApply([
      csvFile(`${CLASS_NAME}_202611_取込用.csv`, monthCells()),
    ]);
    expect(response.status).toBe(200);
    expect(body.kind).toBe("imported");
    expect(body.view.ok).toBe(true);
    expect(body.view.general).toEqual([]);
    expect(body.view.files[0]).toMatchObject({
      className: CLASS_NAME,
      month: "2026-11",
      lessonCount: 17,
      closureCount: 4,
      verdict: "ok",
    });
    expect(body.summary).toEqual({
      months: [{ month: "2026-11", classes: 1, lessons: 17 }],
    });

    const db = testDb();
    const lessons = await db.lesson.findMany({
      where: { classId: ID.classA },
      include: { teachers: true },
      orderBy: { date: "asc" },
    });
    expect(lessons).toHaveLength(17);
    for (const lesson of lessons) {
      expect(lesson).toMatchObject({
        kind: "FIXED",
        subjectName: "プログラミング",
        roomId: ID.roomFree,
        roomName: ROOM_FREE_NAME,
        startMinutes: 9 * 60 + 15,
        endMinutes: 10 * 60 + 45,
        cancelled: false,
      });
      expect(lesson.teachers).toEqual([
        expect.objectContaining({
          teacherName: "田村",
          teacherId: ID.teacher,
        }),
      ]);
    }
    const dates = lessons.map((l) => l.date.toISOString().slice(0, 10));
    for (const off of Object.keys(CLOSURES)) expect(dates).not.toContain(off);

    const status = await db.monthStatus.findUniqueOrThrow({
      where: { classId_month: { classId: ID.classA, month: "202611" } },
    });
    expect(status).toMatchObject({
      importedAt: new Date("2026-11-10T10:00:00+09:00"),
      lastInputDate: textToDateColumn("2026-11-30"),
      nextLastInputDate: null,
      exceptionUnlocked: false,
    });

    // 休み・行事: 全校の行と同じ日付・同じ名称(11/12・11/13・11/23)は保存されない(T-IMP-028)。
    const closures = await db.closure.findMany({
      where: { classId: ID.classA },
    });
    expect(closures).toHaveLength(1);
    expect(closures[0]).toMatchObject({
      name: "文化の日",
      source: "TOOL",
      targetMonth: "202611",
      startDate: textToDateColumn("2026-11-03"),
    });
  });

  it("T-IMP-001b 「確認する」は、何も書き込まない", async () => {
    const { response, view } = await runCheck([csvFile("a.csv", monthCells())]);
    expect(response.status).toBe(200);
    expect(view.ok).toBe(true);
    expect(view.files[0]).toMatchObject({
      verdict: "ok",
      lessonCount: 17,
      closureCount: 4,
    });
    expect(await counts()).toEqual(EMPTY);
  });

  it("T-IMP-002 全部成功か、全部なし: 1 つでもエラーなら、正しいファイルも取り込まれない", async () => {
    await addClass("デザイン専攻1年");
    const bad = monthCells(CLOSURES, "デザイン専攻1年");
    bad[0] = { ...bad[0], 科目: "未登録の教科" };
    const { body } = await runApply([
      csvFile("good.csv", monthCells()),
      csvFile("bad.csv", bad),
    ]);
    expect(body.kind).toBe("invalid");
    expect(body.view.ok).toBe(false);
    expect(body.view.files.map((f) => f.verdict)).toEqual(["ok", "error"]);
    expect(issueOf(body.view.files[1], "ME409")?.message).toBe(
      MESSAGES.ME409("未登録の教科", "教科", FIRST_LESSON_LINE),
    );
    expect(await counts()).toEqual(EMPTY);
  });

  it("T-IMP-003 同じクラス・同じ月のファイルが 2 つなら ME404。取り込まれない", async () => {
    const { body } = await runApply([
      csvFile("a.csv", monthCells()),
      csvFile("b.csv", monthCells()),
    ]);
    expect(body.kind).toBe("invalid");
    for (const file of body.view.files) {
      expect(issueOf(file, "ME404")?.message).toBe(
        MESSAGES.ME404("a.csv", "b.csv"),
      );
      expect(file.verdict).toBe("error");
    }
    expect(await counts()).toEqual(EMPTY);
  });
});

describe("マスタとの突き合わせ(ME408〜ME410、MW401)", () => {
  const first = (rows: Cells[], over: Cells): Cells[] => [
    { ...rows[0], ...over },
    ...rows.slice(1),
  ];

  it("T-IMP-011a マスタにない教科は ME409(値・種類・行番号)", async () => {
    const { view } = await runCheck([
      csvFile("a.csv", first(monthCells(), { 科目: "存在しない教科" })),
    ]);
    const issue = issueOf(view.files[0], "ME409");
    expect(issue).toMatchObject({
      level: "error",
      line: FIRST_LESSON_LINE,
      message: MESSAGES.ME409("存在しない教科", "教科", FIRST_LESSON_LINE),
    });
    expect(view.ok).toBe(false);
  });

  it("T-IMP-011b マスタにない講師は ME409", async () => {
    const { view } = await runCheck([
      csvFile("a.csv", first(monthCells(), { 講師: "存在しない講師" })),
    ]);
    expect(issueOf(view.files[0], "ME409")).toMatchObject({
      line: FIRST_LESSON_LINE,
      message: MESSAGES.ME409("存在しない講師", "講師", FIRST_LESSON_LINE),
    });
    expect(view.ok).toBe(false);
  });

  it("T-IMP-011c マスタにない教室は ME409", async () => {
    const { view } = await runCheck([
      csvFile("a.csv", first(monthCells(), { 教室: "存在しない教室" })),
    ]);
    expect(issueOf(view.files[0], "ME409")).toMatchObject({
      line: FIRST_LESSON_LINE,
      message: MESSAGES.ME409("存在しない教室", "教室", FIRST_LESSON_LINE),
    });
    expect(view.ok).toBe(false);
  });

  it("T-IMP-011d マスタにないクラスは ME409", async () => {
    const { view } = await runCheck([
      csvFile("a.csv", monthCells(CLOSURES, "存在しないクラス")),
    ]);
    expect(issueOf(view.files[0], "ME409")).toMatchObject({
      line: FIRST_LESSON_LINE,
      message: MESSAGES.ME409("存在しないクラス", "クラス", FIRST_LESSON_LINE),
    });
    expect(view.ok).toBe(false);
  });

  it("T-IMP-012 無効にしたマスタを使っても取り込める。MW401(警告)", async () => {
    await testDb().teacher.create({
      data: { displayName: "退職者", active: false },
    });
    const rows = first(monthCells(), { 講師: "退職者" });
    const { view } = await runCheck([csvFile("a.csv", rows)]);
    expect(view.ok).toBe(true);
    expect(view.files[0].verdict).toBe("warning");
    expect(issueOf(view.files[0], "MW401")).toMatchObject({
      level: "warning",
      line: FIRST_LESSON_LINE,
      message: MESSAGES.MW401("講師", "退職者", FIRST_LESSON_LINE),
    });

    const { body } = await runApply([csvFile("a.csv", rows)]);
    expect(body.kind).toBe("imported");
    expect(await testDb().lesson.count()).toBe(17);
    expect(
      await testDb().lessonTeacher.count({ where: { teacherName: "退職者" } }),
    ).toBe(1);
  });

  it("T-IMP-013 ホームルーム教室が、クラスマスタと違えば ME410。取り込まれない", async () => {
    const rows = monthCells().map((row) => ({
      ...row,
      ホームルーム教室: "102",
    }));
    const { body } = await runApply([csvFile("a.csv", rows)]);
    expect(body.kind).toBe("invalid");
    expect(issueOf(body.view.files[0], "ME410")).toMatchObject({
      line: FIRST_LESSON_LINE,
      message: MESSAGES.ME410("102", "101"),
    });
    expect(await counts()).toEqual(EMPTY);
  });

  it("T-IMP-014a その年度に存在しないクラス(終了年度が前年)は ME408", async () => {
    await addClass("旧クラス", 2024, 2025);
    const { view } = await runCheck([
      csvFile("a.csv", monthCells(CLOSURES, "旧クラス")),
    ]);
    expect(issueOf(view.files[0], "ME408")?.message).toBe(
      MESSAGES.ME408("旧クラス", 2026),
    );
    expect(view.ok).toBe(false);
  });

  it("T-IMP-014b その年度に存在しないクラス(開始年度が翌年)は ME408", async () => {
    await addClass("未来クラス", 2027);
    const { view } = await runCheck([
      csvFile("a.csv", monthCells(CLOSURES, "未来クラス")),
    ]);
    expect(issueOf(view.files[0], "ME408")?.message).toBe(
      MESSAGES.ME408("未来クラス", 2026),
    );
    expect(view.ok).toBe(false);
  });
});

describe("上限(ME418。08章 8-2)", () => {
  const filler = (size: number) => new Uint8Array(size).fill(0x61); // "a"

  it("T-IMP-020a ファイルが 51 個なら ME418(全体のエラー)。50 個までは数の上限に当たらない", async () => {
    const tiny = (i: number): Upload => ({
      name: `f${i}.csv`,
      bytes: utf8("x"),
    });
    const over = await runCheck(
      Array.from({ length: MAX_FILES + 1 }, (_, i) => tiny(i)),
    );
    expect(over.response.status).toBe(200);
    expect(over.view.general.map((g) => g.code)).toEqual(["ME418"]);
    expect(over.view.ok).toBe(false);

    const exact = await runCheck(
      Array.from({ length: MAX_FILES }, (_, i) => tiny(i)),
    );
    expect(exact.view.general).toEqual([]);
  });

  it("T-IMP-020b 1 ファイルが 1MB を超えれば ME418。ちょうど 1MB は、サイズでは断らない", async () => {
    const over = await runCheck([
      { name: "big.csv", bytes: filler(MAX_FILE_BYTES + 1) },
    ]);
    expect(over.view.files[0].issues.map((i) => i.code)).toEqual(["ME418"]);
    expect(over.view.files[0].verdict).toBe("error");

    const exact = await runCheck([
      { name: "exact.csv", bytes: filler(MAX_FILE_BYTES) },
    ]);
    expect(exact.view.files[0].issues.map((i) => i.code)).not.toContain(
      "ME418",
    );
  });

  it("T-IMP-020c 1 ファイルが 1,001 行なら ME418。1,000 行までは、行数では断らない", async () => {
    const one = monthCells()[0];
    const over = await runCheck([
      csvFile(
        "rows.csv",
        Array.from({ length: 1001 }, () => one),
      ),
    ]);
    expect(over.view.files[0].issues.map((i) => i.code)).toEqual(["ME418"]);

    const exact = await runCheck([
      csvFile(
        "rows.csv",
        Array.from({ length: 1000 }, () => one),
      ),
    ]);
    expect(exact.view.files[0].issues.map((i) => i.code)).not.toContain(
      "ME418",
    );
  });

  it("T-IMP-020d 合計が 4MB を超えれば ME418(全体のエラー)。入り口は受け付ける", async () => {
    const files: Upload[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        name: `big${i}.csv`,
        bytes: filler(MAX_FILE_BYTES),
      })),
      { name: "small.csv", bytes: filler(1000) },
    ];
    expect(
      files.reduce((sum, file) => sum + file.bytes.length, 0),
    ).toBeGreaterThan(MAX_TOTAL_BYTES);
    const { response, view } = await runCheck(files);
    expect(response.status).toBe(200);
    expect(view.general.map((g) => g.code)).toEqual(["ME418"]);
    expect(view.ok).toBe(false);
  });

  it("T-IMP-020e リクエストが大きすぎれば、入り口が 413 と ME418 の文言を返す", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      name: `big${i}.csv`,
      bytes: filler(1_000_000),
    }));
    const response = await check(await upload("/admin/import/check", files));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ message: MESSAGES.ME418 });
    expect(await counts()).toEqual(EMPTY);
  });
});

describe("ファイルの読み方(ME401〜ME403)", () => {
  it("T-IMP-022a UTF-8 でないファイルは ME401", async () => {
    // 「クラス」を Shift_JIS で書いたバイト列(UTF-8 としては読めない)
    const sjis = new Uint8Array([0x83, 0x4e, 0x83, 0x89, 0x83, 0x58]);
    const { view } = await runCheck([{ name: "sjis.csv", bytes: sjis }]);
    expect(view.files[0].issues[0]).toMatchObject({
      level: "error",
      code: "ME401",
      message: MESSAGES.ME401,
    });
    expect(view.files[0].verdict).toBe("error");
    expect(view.ok).toBe(false);
  });

  it("T-IMP-022b 必要な列がなければ ME402(列名の一覧つき)", async () => {
    const head = HEAD.filter((name) => name !== "科目" && name !== "教室");
    const { view } = await runCheck([csvFile("a.csv", monthCells(), head)]);
    expect(view.files[0].issues[0]).toMatchObject({
      level: "error",
      code: "ME402",
      line: 1,
      message: MESSAGES.ME402("科目、教室"),
    });
    expect(view.ok).toBe(false);
  });

  it("T-IMP-023 1 ファイルに複数のクラスがあれば ME403", async () => {
    await addClass("デザイン専攻1年");
    const rows = monthCells().map((row, i) =>
      i < 5 ? row : { ...row, クラス: "デザイン専攻1年" },
    );
    const { view } = await runCheck([csvFile("a.csv", rows)]);
    expect(issueOf(view.files[0], "ME403")?.message).toBe(MESSAGES.ME403);
    expect(view.ok).toBe(false);
  });
});

describe("取り込み直し(R3-2)", () => {
  it("T-IMP-024 同じクラス×月を取り込み直すと、前の授業が消え、新しい授業だけが残る", async () => {
    const firstImport = await runApply([csvFile("a.csv", monthCells())]);
    expect(firstImport.body.kind).toBe("imported");
    const before = await testDb().lesson.findMany({
      select: { id: true },
    });
    expect(before).toHaveLength(17);

    // 2 回目: 11/9(月)と 11/10(火)を休みにした内容(授業 15 件、休み・行事 3 件)
    at("2026-11-10T12:00");
    const second = await runApply([
      csvFile(
        "a.csv",
        monthCells({
          ...CLOSURES,
          "2026-11-09": "臨時休校",
          "2026-11-10": "臨時休校",
        }),
      ),
    ]);
    expect(second.body.kind).toBe("imported");
    expect(second.body.summary).toEqual({
      months: [{ month: "2026-11", classes: 1, lessons: 15 }],
    });

    const db = testDb();
    const after = await db.lesson.findMany({
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    });
    expect(after).toHaveLength(15);
    const dates = after.map((l) => l.date.toISOString().slice(0, 10));
    expect(dates).not.toContain("2026-11-09");
    expect(dates).not.toContain("2026-11-10");
    // 前の授業は、1 件も残っていない(すべて作り直された)
    const oldIds = new Set(before.map((l) => l.id));
    expect(after.some((l) => oldIds.has(l.id))).toBe(false);
    expect(await db.lessonTeacher.count()).toBe(15);
    expect(await db.closure.count({ where: { source: "TOOL" } })).toBe(3);

    const status = await db.monthStatus.findMany();
    expect(status).toHaveLength(1);
    expect(status[0].importedAt).toEqual(new Date("2026-11-10T12:00:00+09:00"));
  });
});
