import { unzipSync } from "fflate";
import { NextRequest } from "next/server";
import Papa from "papaparse";
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

// 書き出し(S24。T-EXP)と、無効の扱い(T-MST-014) (テスト設計書 4-6, 11-6, 11-5): the route, the check
// before the export (R5-6) and a real database. 基準の「いま」は 2026-11-10(火)10:00 JST(2026 年度)。
// ZIP は、入り口(POST /admin/export/download)から受け取って、展開して読む。書き出し前の確認の一覧は、
// 画面(S24)が使う関数(buildExport と loadExportSource)で、同じ状態から作る。
// 期待値は、外部設計書(08章 8-1・8-3、06-3 S24、規則 R5-2・R5-6、メッセージ ME510・MW503)と
// テスト設計書から書いた(tests/cases/export.cases.ts と同じ内容)。

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

import { POST as approve } from "@/app/(main)/teacher/reservations/approve/route";
import { POST as exportDownload } from "@/app/(main)/admin/export/download/route";
import { loadLinkChoices } from "@/lib/server/queries/admin";
import { loadExportSource } from "@/lib/server/queries/export";

const HOST = "mieroom.example";
const YEAR = 2026;

const FILES = {
  classes: "クラスマスタ.csv",
  teachers: "講師マスタ.csv",
  subjects: "教科マスタ.csv",
  rooms: "教室マスタ.csv",
  classSubjects: "紐づけ_クラスの教科.csv",
  subjectTeachers: "紐づけ_教科の講師.csv",
  subjectRooms: "紐づけ_教科の教室.csv",
  closures: "休み・行事.csv",
} as const;
const FILE_NAMES = Object.values(FILES);

const SUBJECT = { prog: "00000000-0000-4000-8000-000000000101" } as const;
const CLASS = {
  other: "00000000-0000-4000-8000-000000000011",
  ended: "00000000-0000-4000-8000-000000000012",
  future: "00000000-0000-4000-8000-000000000013",
  inactive: "00000000-0000-4000-8000-000000000014",
} as const;

const at = (jst: string) => vi.setSystemTime(new Date(`${jst}:00+09:00`));

function request(path: string, body: unknown = {}) {
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

const download = () => exportDownload(request("/admin/export/download"));

/** ZIP の中身: ファイル名 → 生のバイト。 */
async function unzippedBytes(
  response: Response,
): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await response.arrayBuffer()));
}

/**
 * ZIP の中身: ファイル名 → 本文(BOM を含む)。fflate の strFromU8 と、既定の TextDecoder は、先頭の BOM を
 * 取り除くので使わない(BOM を確かめられなくなる)。BOM の有無は、生のバイトでも確かめる(T-EXP-001b)。
 */
async function unzipped(response: Response): Promise<Record<string, string>> {
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  return Object.fromEntries(
    Object.entries(await unzippedBytes(response)).map(([name, bytes]) => [
      name,
      decoder.decode(bytes),
    ]),
  );
}

/** CSV 本文(BOM つき)を、見出しを除いた行の並びにする。 */
function records(text: string): { header: string[]; rows: string[][] } {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: true,
  });
  const [header, ...rows] = parsed.data;
  return { header, rows };
}

/** 書き出し前の確認(画面 S24 と同じ関数)。 */
async function check() {
  const result = buildExport(await loadExportSource(YEAR));
  const errors = result.issues.filter((issue) => issue.level === "error");
  return {
    result,
    errors,
    warnings: result.issues.filter((issue) => issue.level === "warning"),
    checks: errors.map((issue) => issue.check),
  };
}

/** エラーがあれば、ZIP を出さず、409 と ME510(エラーの件数)。 */
async function expectRefused() {
  const { errors } = await check();
  expect(errors.length).toBeGreaterThan(0);
  const response = await download();
  expect(response.status).toBe(409);
  expect(response.headers.get("content-type")).not.toContain("zip");
  expect(await response.text()).toBe(MESSAGES.ME510(errors.length));
}

const db = () => testDb();

/** 書き出せる状態(エラー 0 件)にする: クラスの教科・講師・教室を 1 つずつ。 */
async function makeExportable() {
  await db().subject.create({
    data: { id: SUBJECT.prog, name: "プログラミング" },
  });
  await db().classSubject.create({
    data: { classId: ID.classA, subjectId: SUBJECT.prog },
  });
  await db().subjectTeacher.create({
    data: {
      classId: ID.classA,
      subjectId: SUBJECT.prog,
      teacherId: ID.teacher,
      teacherKey: ID.teacher,
    },
  });
  await db().subjectRoom.create({
    data: {
      classId: ID.classA,
      subjectId: SUBJECT.prog,
      roomId: ID.roomFree,
      roomKey: ID.roomFree,
    },
  });
}

/** 休み・行事(システム)を n 件、1 日に並べて足す(名称で区別する)。 */
const addClosures = (count: number, day = "2027-01-05") =>
  db().closure.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      startDate: textToDateColumn(day),
      name: `行事${index + 1}`,
      source: "SYSTEM" as const,
    })),
  });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T10:00");
  await resetDatabase();
  await seedBase();
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

describe("書き出し(エラー 0 件)", () => {
  it("T-EXP-001a ZIP が返る。名前は ミエルーム_マスタ_日付.zip で、8 つの CSV が入っている", async () => {
    await makeExportable();
    const response = await download();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(decodeURIComponent(disposition)).toContain(
      "ミエルーム_マスタ_20261110.zip",
    );
    const files = await unzipped(response);
    expect(Object.keys(files).sort()).toEqual([...FILE_NAMES].sort());
  });

  it("T-EXP-001b 8 つの CSV の中身: 見出しの順、BOM つき UTF-8、改行は CRLF、行の中身(08章 8-3)", async () => {
    await makeExportable();
    await db().closure.create({
      data: {
        name: "振替休日",
        startDate: textToDateColumn("2026-10-05"),
        source: "SYSTEM",
      },
    }); // 入れた順では最後、日付では最初
    const bytes = await unzippedBytes(await download());
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const files = Object.fromEntries(
      Object.entries(bytes).map(([name, data]) => [name, decoder.decode(data)]),
    );

    for (const name of FILE_NAMES) {
      const text = files[name];
      // 先頭の 3 バイトが、UTF-8 の BOM(EF BB BF)
      expect(Array.from(bytes[name].slice(0, 3)), `${name}: BOM`).toEqual([
        0xef, 0xbb, 0xbf,
      ]);
      expect(text.startsWith("\uFEFF"), `${name}: BOM(文字)`).toBe(true);
      // 改行は CRLF だけ(CR のない LF がない)
      expect(text.replaceAll("\r\n", "").includes("\n"), `${name}: LF`).toBe(
        false,
      );
      expect(text.endsWith("\r\n"), `${name}: 末尾`).toBe(true);
    }

    const read = (name: string) => records(files[name]);
    expect(read(FILES.classes)).toEqual({
      header: ["クラス名", "ホームルーム教室"],
      rows: [["システム専攻1年", "101"]],
    });
    expect(read(FILES.teachers)).toEqual({
      header: ["時間割での表記"],
      rows: [["田村"]],
    });
    expect(read(FILES.subjects)).toEqual({
      header: ["教科名"],
      rows: [["プログラミング"]],
    });
    const rooms = read(FILES.rooms);
    expect(rooms.header).toEqual(["教室名", "棟・階", "分類", "備考"]);
    expect(rooms.rows.map((row) => row.join("|")).sort()).toEqual(
      ["101||ホームルーム|", "展示室||空き教室|"].sort(),
    );
    expect(read(FILES.classSubjects)).toEqual({
      header: ["クラス", "教科"],
      rows: [["システム専攻1年", "プログラミング"]],
    });
    expect(read(FILES.subjectTeachers)).toEqual({
      header: ["クラス", "教科", "講師"],
      rows: [["システム専攻1年", "プログラミング", "田村"]],
    });
    expect(read(FILES.subjectRooms)).toEqual({
      header: ["クラス", "教科", "教室"],
      rows: [["システム専攻1年", "プログラミング", "展示室"]],
    });
    // 休み・行事: 開始日の順(入れた順と逆の行を足して、並べ替えを確かめる)。終了日は、1 日だけのものは
    // 空欄。対象クラスは、全校は空欄
    expect(read(FILES.closures)).toEqual({
      header: ["開始日", "終了日", "名称", "対象クラス"],
      rows: [
        ["2026-10-05", "", "振替休日", ""],
        ["2026-11-12", "2026-11-13", "学園祭", ""],
        ["2026-11-23", "", "勤労感謝の日", ""],
        ["2026-12-09", "", "防災訓練", ""],
      ],
    });
  });

  it('T-EXP-001c 「各担当」は講師マスタには出さず、教科の講師の行にだけ出す。教室未定は「ー」。「,」「"」を含む欄は囲む', async () => {
    await makeExportable();
    // 教科の講師を「各担当」、教科の教室を「教室未定」に変える
    await db().subjectTeacher.deleteMany({});
    await db().subjectTeacher.create({
      data: {
        classId: ID.classA,
        subjectId: SUBJECT.prog,
        teacherId: null,
        teacherKey: "each",
      },
    });
    await db().subjectRoom.deleteMany({});
    await db().subjectRoom.create({
      data: {
        classId: ID.classA,
        subjectId: SUBJECT.prog,
        roomId: null,
        roomKey: "none",
      },
    });
    // 「,」と「"」を含む教室の棟・備考
    await db().room.create({
      data: {
        name: "会議室",
        building: '本館 "A"',
        kind: "FREE",
        note: "机,椅子あり",
      },
    });

    const files = await unzipped(await download());
    expect(records(files[FILES.teachers]).rows).toEqual([["田村"]]);
    expect(records(files[FILES.subjectTeachers]).rows).toEqual([
      ["システム専攻1年", "プログラミング", "各担当"],
    ]);
    expect(records(files[FILES.subjectRooms]).rows).toEqual([
      ["システム専攻1年", "プログラミング", "ー"],
    ]);
    const room = records(files[FILES.rooms]).rows.find(
      (row) => row[0] === "会議室",
    );
    expect(room).toEqual(["会議室", '本館 "A"', "空き教室", "机,椅子あり"]);
    // 囲みは、「,」や「"」があるときだけ。「"」は「""」にする
    expect(files[FILES.rooms]).toContain(
      '会議室,"本館 ""A""",空き教室,"机,椅子あり"',
    );
    expect(files[FILES.teachers]).not.toContain('"');
  });
});

describe("書き出す範囲", () => {
  it("T-EXP-003a 今年度に存在する有効なクラスと、有効なマスタだけ。終わった・まだ・無効なクラス、無効な講師・教科・教室は出ない", async () => {
    await makeExportable();
    await db().schoolClass.createMany({
      data: [
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
      ],
    });
    await db().subject.create({ data: { name: "旧教科", active: false } });
    await db().teacher.create({
      data: { displayName: "退職者", active: false },
    });
    await db().room.create({
      data: { name: "旧教室", kind: "FREE", active: false },
    });

    const response = await download();
    expect(response.status).toBe(200);
    const files = await unzipped(response);
    expect(records(files[FILES.classes]).rows.map((row) => row[0])).toEqual([
      "システム専攻1年",
    ]);
    expect(records(files[FILES.teachers]).rows.map((row) => row[0])).toEqual([
      "田村",
    ]);
    expect(records(files[FILES.subjects]).rows.map((row) => row[0])).toEqual([
      "プログラミング",
    ]);
    expect(
      records(files[FILES.rooms])
        .rows.map((row) => row[0])
        .sort(),
    ).toEqual(["101", "展示室"].sort());
  });

  it("T-EXP-003b 休み・行事は、出どころがシステムの行で、今年度(4/1〜翌 3/31)と翌 4/1〜4/11 にかかるものだけ", async () => {
    await makeExportable();
    const closure = (
      name: string,
      start: string,
      end: string | null = null,
      extra: { source?: "SYSTEM" | "TOOL"; classId?: string } = {},
    ) =>
      db().closure.create({
        data: {
          name,
          startDate: textToDateColumn(start),
          endDate: end === null ? null : textToDateColumn(end),
          source: extra.source ?? "SYSTEM",
          classId: extra.classId ?? null,
          ...(extra.source === "TOOL" ? { targetMonth: "202611" } : {}),
        },
      });
    await closure("前年度の最終日", "2026-03-31"); // 出ない(前の年度)
    await closure("年度またぎ", "2026-03-31", "2026-04-01"); // 出る(4/1 にかかる)
    await closure("年度の初日", "2026-04-01"); // 出る
    await closure("年度の最終日", "2027-03-31"); // 出る
    await closure("翌年度の 4/11", "2027-04-11"); // 出る
    await closure("翌年度の 4/12", "2027-04-12"); // 出ない
    await closure("ツールの行", "2026-11-18", null, {
      source: "TOOL",
      classId: ID.classA,
    }); // 出ない(出どころがツール)
    await closure("クラスの行事", "2026-11-19", null, { classId: ID.classA }); // 出る(対象クラスつき)
    await db().schoolClass.create({
      data: {
        id: CLASS.ended,
        name: "旧クラス",
        homeRoomId: ID.roomFree,
        startYear: 2024,
        endYear: 2025,
      },
    });
    await closure("旧クラスの行事", "2026-11-20", null, {
      classId: CLASS.ended,
    }); // 出ない(書き出さないクラス)。エラーにもしない

    const response = await download();
    expect(response.status).toBe(200);
    const rows = records((await unzipped(response))[FILES.closures]).rows;
    const names = rows.map((row) => row[2]);
    expect(names.sort()).toEqual(
      [
        "学園祭",
        "勤労感謝の日",
        "防災訓練",
        "年度またぎ",
        "年度の初日",
        "年度の最終日",
        "翌年度の 4/11",
        "クラスの行事",
      ].sort(),
    );
    expect(rows.find((row) => row[2] === "クラスの行事")?.[3]).toBe(
      "システム専攻1年",
    );
    expect(rows.find((row) => row[2] === "年度またぎ")).toEqual([
      "2026-03-31",
      "2026-04-01",
      "年度またぎ",
      "",
    ]);
  });

  it("T-EXP-014 終わったクラス・無効なクラスの紐づけ・休み・行事は、黙って書き出しから除く(エラーにしない)", async () => {
    await makeExportable();
    await db().schoolClass.createMany({
      data: [
        {
          id: CLASS.ended,
          name: "旧クラス",
          homeRoomId: ID.roomHome, // 同じホームルーム教室(出すクラスと重なっても、除くクラスは数えない)
          startYear: 2024,
          endYear: 2025,
        },
        {
          id: CLASS.inactive,
          name: "無効クラス",
          homeRoomId: ID.roomFree,
          startYear: 2026,
          active: false,
        },
      ],
    });
    await db().teacher.create({
      data: {
        id: "00000000-0000-4000-8000-000000000122",
        displayName: "退職者",
        active: false,
      },
    });
    for (const classId of [CLASS.ended, CLASS.inactive]) {
      // そのクラスの紐づけ。出すクラスなら、エラーになるもの(講師の行がない・無効な講師)を入れておく
      await db().classSubject.create({
        data: { classId, subjectId: SUBJECT.prog },
      });
      await db().subjectTeacher.create({
        data: {
          classId,
          subjectId: SUBJECT.prog,
          teacherId: "00000000-0000-4000-8000-000000000122",
          teacherKey: "00000000-0000-4000-8000-000000000122",
        },
      });
      await db().closure.create({
        data: {
          name: `${classId.slice(-2)}の行事`,
          startDate: textToDateColumn("2026-11-25"),
          source: "SYSTEM",
          classId,
        },
      });
    }

    const { errors } = await check();
    expect(errors).toEqual([]);
    const response = await download();
    expect(response.status).toBe(200);
    const files = await unzipped(response);
    expect(records(files[FILES.classSubjects]).rows).toEqual([
      ["システム専攻1年", "プログラミング"],
    ]);
    expect(records(files[FILES.subjectTeachers]).rows).toEqual([
      ["システム専攻1年", "プログラミング", "田村"],
    ]);
    expect(
      records(files[FILES.closures]).rows.map((row) => row[2]),
    ).not.toContain("12の行事");
    expect(records(files[FILES.closures]).rows).toHaveLength(3); // 全校の 3 件だけ
  });
});

describe("書き出し前の確認(R5-6)と、書き出しの拒否(ME510)", () => {
  it("T-EXP-002 エラーが 1 件でもあれば、ZIP は出ず、409 と ME510(エラーの件数)", async () => {
    await makeExportable();
    expect((await check()).errors).toEqual([]);
    // 教科を足す(講師の行がない)と、エラーが 1 件
    await db().subject.create({
      data: { id: "00000000-0000-4000-8000-000000000102", name: "数学" },
    });
    await db().classSubject.create({
      data: {
        classId: ID.classA,
        subjectId: "00000000-0000-4000-8000-000000000102",
      },
    });
    const { errors } = await check();
    expect(errors).toHaveLength(1);
    const response = await download();
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(MESSAGES.ME510(1));
  });

  it("T-EXP-005 確認 1: クラスのホームルーム教室が無効だと、エラー", async () => {
    await makeExportable();
    await db().room.update({
      where: { id: ID.roomHome },
      data: { active: false },
    });
    expect((await check()).checks).toContain(1);
    await expectRefused();
  });

  it("T-EXP-006 確認 2: 同じ年度のクラスで、ホームルーム教室が重なると、エラー", async () => {
    await makeExportable();
    await db().schoolClass.create({
      data: {
        id: CLASS.other,
        name: "ゲーム専攻1年",
        homeRoomId: ID.roomHome,
        startYear: 2026,
      },
    });
    expect((await check()).checks).toContain(2);
    await expectRefused();
  });

  it("T-EXP-007 確認 3: クラスの教科に、講師の行がない教科があると、エラー(各担当の行ならよい)", async () => {
    await makeExportable();
    await db().subject.create({
      data: { id: "00000000-0000-4000-8000-000000000102", name: "数学" },
    });
    await db().classSubject.create({
      data: {
        classId: ID.classA,
        subjectId: "00000000-0000-4000-8000-000000000102",
      },
    });
    expect((await check()).checks).toContain(3);
    await expectRefused();
    // 各担当の行を足すと、直る
    await db().subjectTeacher.create({
      data: {
        classId: ID.classA,
        subjectId: "00000000-0000-4000-8000-000000000102",
        teacherId: null,
        teacherKey: "each",
      },
    });
    expect((await check()).checks).not.toContain(3);
  });

  it("T-EXP-008 確認 4: 教科の講師・教室の行が、クラスの教科にないと、エラー", async () => {
    await makeExportable();
    await db().classSubject.deleteMany({}); // 講師・教室の行は残る
    const { checks } = await check();
    expect(checks.filter((n) => n === 4)).toHaveLength(2); // 講師の行と、教室の行
    await expectRefused();
  });

  it("T-EXP-009 確認 5: 紐づけが、無効な講師・教科・教室を指していると、エラー", async () => {
    await makeExportable();
    await db().teacher.update({
      where: { id: ID.teacher },
      data: { active: false },
    });
    expect((await check()).checks).toContain(5);
    await db().teacher.update({
      where: { id: ID.teacher },
      data: { active: true },
    });
    await db().room.update({
      where: { id: ID.roomFree },
      data: { active: false },
    });
    expect((await check()).checks).toContain(5);
    await db().room.update({
      where: { id: ID.roomFree },
      data: { active: true },
    });
    await db().subject.update({
      where: { id: SUBJECT.prog },
      data: { active: false },
    });
    expect((await check()).checks).toContain(5);
    await expectRefused();
  });
});

describe("行数の上限(R5-6 の 6・7)", () => {
  it("T-EXP-004 休み・行事: 180 行までは警告なし、181 行から警告(MW503)。書き出しはできる", async () => {
    await makeExportable();
    await addClosures(177); // seed の 3 件と合わせて 180 行
    let state = await check();
    expect(state.warnings).toEqual([]);
    expect(state.errors).toEqual([]);

    await addClosures(1, "2027-01-06"); // 181 行
    state = await check();
    expect(state.errors).toEqual([]);
    expect(state.warnings.map((warning) => warning.message)).toEqual([
      MESSAGES.MW503(181),
    ]);
    expect((await download()).status).toBe(200);
  });

  it("T-EXP-010 確認 6: 休み・行事は、200 行まで書き出せる。201 行からエラー", async () => {
    await makeExportable();
    await addClosures(197); // seed の 3 件と合わせて 200 行
    let state = await check();
    expect(state.errors).toEqual([]);
    expect((await download()).status).toBe(200);

    await addClosures(1, "2027-01-06"); // 201 行
    state = await check();
    expect(state.checks).toContain(6);
    await expectRefused();
  });

  it("T-EXP-011a 確認 7: マスタは各 100 行まで。講師が 100 行は可、101 行からエラー", async () => {
    await makeExportable();
    await db().teacher.createMany({
      data: Array.from({ length: 99 }, (_, index) => ({
        displayName: `講師${index + 1}`,
      })),
    }); // 田村と合わせて 100 行
    expect((await check()).errors).toEqual([]);
    expect((await download()).status).toBe(200);

    await db().teacher.create({ data: { displayName: "講師100" } }); // 101 行
    const { errors } = await check();
    expect(errors.filter((issue) => issue.check === 7)).toHaveLength(1);
    expect(errors.find((issue) => issue.check === 7)?.target).toBe(
      FILES.teachers,
    );
    await expectRefused();
  });

  it("T-EXP-011b 確認 7: 紐づけは各 1,000 行まで。クラスの教科が 1,000 行は可、1,001 行からエラー", async () => {
    // 教科 100 × クラス 10 = 1,000 行(クラスは、教室「展示室」をそれぞれのホームルーム教室にする)
    const subjects = Array.from({ length: 100 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`,
      name: `教科${index + 1}`,
    }));
    await db().subject.createMany({ data: subjects });
    const rooms = Array.from({ length: 11 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(2000 + index).padStart(12, "0")}`,
      name: `教室${index + 1}`,
      kind: "HOMEROOM" as const,
    }));
    await db().room.createMany({ data: rooms });
    const classes = Array.from({ length: 11 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(3000 + index).padStart(12, "0")}`,
      name: `クラス${index + 1}`,
      homeRoomId: rooms[index].id,
      startYear: 2026,
    }));
    await db().schoolClass.createMany({ data: classes });
    await db().classSubject.createMany({
      data: classes.slice(0, 10).flatMap((klass) =>
        subjects.map((subject) => ({
          classId: klass.id,
          subjectId: subject.id,
        })),
      ),
    });
    await db().subjectTeacher.createMany({
      data: classes.slice(0, 10).flatMap((klass) =>
        subjects.map((subject) => ({
          classId: klass.id,
          subjectId: subject.id,
          teacherId: null,
          teacherKey: "each",
        })),
      ),
    }); // 教科の講師も 1,000 行(上限ちょうど)
    const before = await check();
    expect(before.result.rowCounts.classSubjects).toBe(1000);
    expect(before.result.rowCounts.subjects).toBe(100);
    // 1,000 行・100 行は、上限の内側: 確認 7 は出ない
    expect(before.checks).not.toContain(7);

    // 11 番目のクラスに教科を 1 つ足すと、クラスの教科が 1,001 行
    await db().classSubject.create({
      data: { classId: classes[10].id, subjectId: subjects[0].id },
    });
    const after = await check();
    const over = after.errors.filter((issue) => issue.check === 7);
    expect(over.map((issue) => issue.target)).toEqual([FILES.classSubjects]);
  });

  it("T-EXP-012 空のファイルは、エラー(ツールが受け付けない)。どのファイルが空かが出る", async () => {
    // seed だけ: 教科・クラスの教科・教科の講師・教科の教室が空
    const { errors, checks } = await check();
    const empty = errors
      .filter((issue) => issue.check === null)
      .map((issue) => issue.target)
      .sort();
    expect(empty).toEqual(
      [
        FILES.subjects,
        FILES.classSubjects,
        FILES.subjectTeachers,
        FILES.subjectRooms,
      ].sort(),
    );
    expect(checks.every((n) => n === null)).toBe(true);
    await expectRefused();
  });

  it("T-EXP-013 同じ休み・行事が重複していると、エラー(ツールが受け付けない)", async () => {
    await makeExportable();
    for (let n = 0; n < 2; n++) {
      await db().closure.create({
        data: {
          name: "重複の行事",
          startDate: textToDateColumn("2026-11-30"),
          source: "SYSTEM",
        },
      });
    }
    const { errors } = await check();
    expect(errors).toHaveLength(1);
    expect(errors[0].check).toBeNull();
    expect(errors[0].message).toContain("重複の行事");
    await expectRefused();
    // 1 つにすると、書き出せる
    await db().closure.deleteMany({ where: { name: "重複の行事" } });
    await db().closure.create({
      data: {
        name: "重複の行事",
        startDate: textToDateColumn("2026-11-30"),
        source: "SYSTEM",
      },
    });
    expect((await download()).status).toBe(200);
  });

  it("T-EXP-015 確認の一覧には、直す画面へのリンクが出る(クラス・紐づけ・休み・行事の画面)", async () => {
    await makeExportable();
    await db().room.update({
      where: { id: ID.roomHome },
      data: { active: false },
    }); // 確認 1
    await db().subject.create({
      data: { id: "00000000-0000-4000-8000-000000000102", name: "数学" },
    });
    await db().classSubject.create({
      data: {
        classId: ID.classA,
        subjectId: "00000000-0000-4000-8000-000000000102",
      },
    }); // 確認 3
    await addClosures(201); // 確認 6
    const { errors } = await check();
    const fix = (n: number) =>
      errors.find((issue) => issue.check === n)?.fixPath;
    expect(fix(1)).toMatch(/^\/admin\/masters\/classes/);
    expect(fix(3)).toMatch(/^\/admin\/links/);
    expect(fix(6)).toMatch(/^\/admin\/closures/);
  });
});

describe("無効の扱い(R5-2)", () => {
  it("T-MST-014a 無効にしたものは、選択肢と書き出しから外れる。紐づけの追加の窓には出ない", async () => {
    await makeExportable();
    await db().subject.create({ data: { name: "旧教科", active: false } });
    await db().teacher.create({
      data: { displayName: "退職者", active: false },
    });
    await db().room.create({
      data: { name: "旧教室", kind: "FREE", active: false },
    });
    const choices = await loadLinkChoices(ID.classA);
    expect(choices.newSubjects.map((item) => item.name)).not.toContain(
      "旧教科",
    );
    expect(choices.teachers.map((item) => item.name)).not.toContain("退職者");
    expect(choices.rooms.map((item) => item.name)).not.toContain("旧教室");
    const files = await unzipped(await download());
    expect(files[FILES.subjects]).not.toContain("旧教科");
    expect(files[FILES.teachers]).not.toContain("退職者");
    expect(files[FILES.rooms]).not.toContain("旧教室");
  });

  it("T-MST-014b 無効にしたクラスは、承認の判定(全クラスが入力済みか)から外れる。有効なクラスは外れない", async () => {
    // 11 月の時間割が入力済み(取込済み)のクラスは classA だけ。もう 1 つのクラスは未入力
    await db().monthStatus.create({
      data: { classId: ID.classA, month: "202611", importedAt: new Date() },
    });
    await db().schoolClass.create({
      data: {
        id: CLASS.other,
        name: "ゲーム専攻1年",
        homeRoomId: ID.roomFree,
        startYear: 2026,
      },
    });
    const reserve = (slot: number) =>
      db().reservation.create({
        data: {
          roomId: ID.roomFree,
          date: textToDateColumn("2026-11-16"),
          purpose: "自習",
          status: "PENDING",
          applicantId: USERS.student.id,
          applicantName: USERS.student.name,
          slots: { create: [{ slot }] },
        },
        select: { id: true },
      });
    const run = async (id: string) => {
      session.user = USERS.teacher;
      try {
        return await approve(request("/teacher/reservations/approve", { id }));
      } finally {
        session.user = USERS.admin;
      }
    };

    // 有効な間は、入力済みでないクラスがあるので承認できない(ME201)
    const first = await reserve(1);
    const blocked = await run(first.id);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      message: MESSAGES.ME201("ゲーム専攻1年"),
    });
    // 無効にすると、判定から外れて承認できる
    await db().schoolClass.update({
      where: { id: CLASS.other },
      data: { active: false },
    });
    expect((await run(first.id)).status).toBe(200);
    // 有効に戻すと、また判定に入る
    await db().schoolClass.update({
      where: { id: CLASS.other },
      data: { active: true },
    });
    const second = await reserve(3); // 別の枠(承認済みの予約との重なりの確認 MC201 と混ざらない)
    const again = await run(second.id);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      message: MESSAGES.ME201("ゲーム専攻1年"),
    });
  });
});
