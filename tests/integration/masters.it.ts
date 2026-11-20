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

// マスタの追加・編集・無効・名前の変更 (S21。T-MST、テスト設計書 4-6, 11-5): the routes, the server
// functions and a real database. 基準の「いま」は 2026-11-10(火)10:00 JST。
// 画面(components/screens/master-editor.tsx)は、`{ kind: タブ, id, version, ...フォームの項目 }` の順で
// 送る。教室のフォームには、分類の欄 `kind`(HOMEROOM か FREE)があり、**後ろから上書きする**。教室の
// テストは、その形のまま送る(画面と同じ本文)。ほかの 3 つ(クラス・講師・教科)には、`kind` の欄がない。
// 期待値は、外部設計書とテスト設計書から書いた(tests/cases/masters.cases.ts と同じ内容)。

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

import { POST as active } from "@/app/(main)/admin/masters/active/route";
import { POST as save } from "@/app/(main)/admin/masters/save/route";
import { loadImportRows } from "@/lib/server/queries/admin";

const HOST = "mieroom.example";
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";

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

type FieldErrors = { field: string; message: string }[];
type SaveBody = {
  notice?: string;
  renamed?: boolean;
  exportIssues?: number;
  errors?: FieldErrors;
  message?: string;
};

/** 画面と同じ本文の作り方(master-editor.tsx): kind: タブ、編集なら id と version、そのあとにフォームの項目。 */
const screenBody = (
  tab: string,
  form: Record<string, string>,
  row?: { id: string; version: Date },
) => ({
  kind: tab,
  ...(row ? { id: row.id, version: row.version.toISOString() } : {}),
  ...form,
});

const send = async (body: unknown) => {
  const response = await save(post("/admin/masters/save", body));
  return { response, body: (await response.json()) as SaveBody };
};
const toggle = async (kind: unknown, id: unknown, activeValue: unknown) => {
  const response = await active(
    post("/admin/masters/active", { kind, id, active: activeValue }),
  );
  return { response, body: (await response.json()) as SaveBody };
};

/** 教室のフォームの項目(画面の欄と同じ)。 */
const roomForm = (over: Partial<Record<string, string>> = {}) => ({
  name: "201",
  building: "",
  kind: "FREE",
  note: "",
  ...over,
});
const classForm = (over: Partial<Record<string, string>> = {}) => ({
  name: "新しいクラス",
  homeRoomId: ID.roomHome,
  startYear: "2026",
  endYear: "",
  ...over,
});

const half = (n: number) => "a".repeat(n);
/** 全角 15 文字 + 半角のぶん: 全角・半角を問わず、1 文字と数える(6-3)。 */
const mixed = (n: number) =>
  `${"あ".repeat(Math.floor(n / 2))}${half(n - Math.floor(n / 2))}`;

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

const db = () => testDb();

describe("教室(画面と同じ本文。分類の欄 kind が、マスタの種類 kind を上書きする)", () => {
  it.fails("T-MST-001a [既知 #34] 教室を追加・編集できる(MI501)", async () => {
    const added = await send(
      screenBody(
        "rooms",
        roomForm({ name: "201", building: "本館", note: "自習用" }),
      ),
    );
    expect(added.response.status).toBe(200);
    expect(added.body).toMatchObject({ notice: "MI501", renamed: false });
    const room = await db().room.findUniqueOrThrow({ where: { name: "201" } });
    expect(room).toMatchObject({
      building: "本館",
      kind: "FREE",
      note: "自習用",
    });

    const edited = await send(
      screenBody(
        "rooms",
        roomForm({ name: "202", building: "本館", kind: "HOMEROOM", note: "" }),
        { id: room.id, version: room.updatedAt },
      ),
    );
    expect(edited.response.status).toBe(200);
    expect(edited.body).toMatchObject({ notice: "MI501", renamed: true });
    expect(
      await db().room.findUniqueOrThrow({ where: { id: room.id } }),
    ).toMatchObject({ name: "202", kind: "HOMEROOM", note: null });
  });

  it.fails(
    "T-MST-003e [既知 #34] 教室の文字数の境界(教室 20、棟・階 20、備考 50)。ちょうどは保存でき、超えると ME504",
    async () => {
      const ok = await send(
        screenBody(
          "rooms",
          roomForm({ name: mixed(20), building: mixed(20), note: mixed(50) }),
        ),
      );
      expect(ok.response.status).toBe(200);

      const over = await send(
        screenBody(
          "rooms",
          roomForm({ name: mixed(21), building: mixed(21), note: mixed(51) }),
        ),
      );
      expect(over.response.status).toBe(400);
      expect(over.body.errors).toEqual([
        { field: "name", message: MESSAGES.ME504(20) },
        { field: "building", message: MESSAGES.ME504(20) },
        { field: "note", message: MESSAGES.ME504(50) },
      ]);
      expect(await db().room.count({ where: { name: mixed(21) } })).toBe(0);
    },
  );

  it.fails(
    "T-MST-005b [既知 #34] 教室名「ー」は、教室未定のしるしなので、ME518",
    async () => {
      for (const name of ["ー", "-"]) {
        const { response, body } = await send(
          screenBody("rooms", roomForm({ name })),
        );
        expect(response.status).toBe(400);
        expect(body.errors).toEqual([
          { field: "name", message: MESSAGES.ME518 },
        ]);
      }
      expect(await db().room.count()).toBe(2); // seedBase の 2 部屋のまま
    },
  );

  it.fails(
    "T-MST-009a [既知 #34] 教室の名前を変えると、今日以降の授業の表示名も変わる。過去の授業は、当時の名前のまま",
    async () => {
      const lesson = (date: string) => ({
        classId: ID.classA,
        date: textToDateColumn(date),
        startMinutes: PERIOD.p1.start,
        endMinutes: PERIOD.p1.end,
        subjectName: "プログラミング",
        roomId: ID.roomFree,
        roomName: ROOM_FREE_NAME,
        kind: "FIXED" as const,
      });
      await db().lesson.create({ data: lesson("2026-11-09") }); // 昨日(過去)
      await db().lesson.create({ data: lesson("2026-11-10") }); // 今日
      await db().lesson.create({ data: lesson("2026-11-16") }); // これから
      const room = await db().room.findUniqueOrThrow({
        where: { id: ID.roomFree },
      });

      const { response, body } = await send(
        screenBody("rooms", roomForm({ name: "展示室2", kind: "FREE" }), {
          id: room.id,
          version: room.updatedAt,
        }),
      );
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ notice: "MI501", renamed: true });
      const names = await db().lesson.findMany({
        orderBy: { date: "asc" },
        select: { date: true, roomName: true },
      });
      expect(names.map((l) => l.roomName)).toEqual([
        ROOM_FREE_NAME,
        "展示室2",
        "展示室2",
      ]);
    },
  );
});

describe("クラス・講師・教科の追加と編集(R5-1)", () => {
  it("T-MST-001b 講師を追加・編集できる", async () => {
    const added = await send(screenBody("teachers", { displayName: "山田" }));
    expect(added.response.status).toBe(200);
    expect(added.body).toMatchObject({ notice: "MI501", renamed: false });
    const row = await db().teacher.findUniqueOrThrow({
      where: { displayName: "山田" },
    });
    const edited = await send(
      screenBody(
        "teachers",
        { displayName: "山田太郎" },
        {
          id: row.id,
          version: row.updatedAt,
        },
      ),
    );
    expect(edited.body).toMatchObject({ notice: "MI501", renamed: true });
    expect(
      (await db().teacher.findUniqueOrThrow({ where: { id: row.id } }))
        .displayName,
    ).toBe("山田太郎");
  });

  it("T-MST-001c 教科を追加・編集できる", async () => {
    const added = await send(screenBody("subjects", { name: "数学" }));
    expect(added.body).toMatchObject({ notice: "MI501", renamed: false });
    const row = await db().subject.findUniqueOrThrow({
      where: { name: "数学" },
    });
    const edited = await send(
      screenBody(
        "subjects",
        { name: "数学I" },
        {
          id: row.id,
          version: row.updatedAt,
        },
      ),
    );
    expect(edited.body).toMatchObject({ notice: "MI501", renamed: true });
    expect(
      (await db().subject.findUniqueOrThrow({ where: { id: row.id } })).name,
    ).toBe("数学I");
  });

  it("T-MST-001d クラスを追加・編集できる(ホームルーム教室・開始年度・終了年度)", async () => {
    const added = await send(
      screenBody(
        "classes",
        classForm({ name: "デザイン専攻1年", endYear: "2028" }),
      ),
    );
    expect(added.response.status).toBe(200);
    expect(added.body).toMatchObject({ notice: "MI501", renamed: false });
    const row = await db().schoolClass.findUniqueOrThrow({
      where: { name: "デザイン専攻1年" },
    });
    expect(row).toMatchObject({
      homeRoomId: ID.roomHome,
      startYear: 2026,
      endYear: 2028,
      active: true,
    });
    const edited = await send(
      screenBody(
        "classes",
        classForm({ name: "デザイン専攻1年", endYear: "" }),
        {
          id: row.id,
          version: row.updatedAt,
        },
      ),
    );
    expect(edited.body).toMatchObject({ notice: "MI501", renamed: false });
    expect(
      (await db().schoolClass.findUniqueOrThrow({ where: { id: row.id } }))
        .endYear,
    ).toBeNull();
  });
});

describe("名前・文字数・形の規則(R5-1)", () => {
  it("T-MST-002 名前の重複は ME502(無効にしたものも含む)。自分の名前のままの編集は、できる", async () => {
    await db().subject.create({ data: { name: "休止教科", active: false } });
    await db().teacher.create({
      data: { displayName: "休止講師", active: false },
    });
    await db().schoolClass.create({
      data: {
        name: "休止クラス",
        homeRoomId: ID.roomHome,
        startYear: 2026,
        active: false,
      },
    });
    const cases: [string, Record<string, string>, string][] = [
      ["subjects", { name: "休止教科" }, "name"],
      ["subjects", { name: "プログラミング" }, "name"],
      ["teachers", { displayName: "休止講師" }, "displayName"],
      ["teachers", { displayName: "田村" }, "displayName"],
      ["classes", classForm({ name: "休止クラス" }), "name"],
      ["classes", classForm({ name: "システム専攻1年" }), "name"],
    ];
    for (const [tab, form, field] of cases) {
      const { response, body } = await send(screenBody(tab, form));
      expect(response.status).toBe(400);
      expect(body.errors).toEqual([{ field, message: MESSAGES.ME502 }]);
    }
    // 自分の名前のままの編集は、重複としない
    const own = await db().subject.findUniqueOrThrow({
      where: { name: "プログラミング" },
    });
    const same = await send(
      screenBody(
        "subjects",
        { name: "プログラミング" },
        {
          id: own.id,
          version: own.updatedAt,
        },
      ),
    );
    expect(same.response.status).toBe(200);
    expect(same.body.renamed).toBe(false);
  });

  it("T-MST-003a クラス名の文字数の境界(30)。ちょうどは保存でき、31 で ME504", async () => {
    const ok = await send(
      screenBody("classes", classForm({ name: mixed(30) })),
    );
    expect(ok.response.status).toBe(200);
    const over = await send(
      screenBody("classes", classForm({ name: mixed(31) })),
    );
    expect(over.response.status).toBe(400);
    expect(over.body.errors).toEqual([
      { field: "name", message: MESSAGES.ME504(30) },
    ]);
  });

  it("T-MST-003b 講師名の文字数の境界(20)。ちょうどは保存でき、21 で ME504", async () => {
    expect(
      (await send(screenBody("teachers", { displayName: mixed(20) }))).response
        .status,
    ).toBe(200);
    const over = await send(screenBody("teachers", { displayName: mixed(21) }));
    expect(over.response.status).toBe(400);
    expect(over.body.errors).toEqual([
      { field: "displayName", message: MESSAGES.ME504(20) },
    ]);
  });

  it("T-MST-003c 教科名の文字数の境界(30)。ちょうどは保存でき、31 で ME504", async () => {
    expect(
      (await send(screenBody("subjects", { name: mixed(30) }))).response.status,
    ).toBe(200);
    const over = await send(screenBody("subjects", { name: mixed(31) }));
    expect(over.response.status).toBe(400);
    expect(over.body.errors).toEqual([
      { field: "name", message: MESSAGES.ME504(30) },
    ]);
  });

  it("T-MST-004 講師「各担当」「外部講師」は登録できない(ME503)", async () => {
    for (const displayName of ["各担当", "外部講師"]) {
      const { response, body } = await send(
        screenBody("teachers", { displayName }),
      );
      expect(response.status).toBe(400);
      expect(body.errors).toEqual([
        { field: "displayName", message: MESSAGES.ME503 },
      ]);
    }
    expect(await db().teacher.count()).toBe(1); // seedBase の田村だけ
  });

  it("T-MST-005a 講師名に「、」は使えない(ME515)", async () => {
    const { response, body } = await send(
      screenBody("teachers", { displayName: "山田、佐藤" }),
    );
    expect(response.status).toBe(400);
    expect(body.errors).toEqual([
      { field: "displayName", message: MESSAGES.ME515 },
    ]);
  });

  it("T-MST-007 クラスの年度: 終了が開始より前は ME505、4 桁の数字でなければ ME517", async () => {
    const before = await send(
      screenBody("classes", classForm({ startYear: "2026", endYear: "2025" })),
    );
    expect(before.body.errors).toEqual([
      { field: "endYear", message: MESSAGES.ME505 },
    ]);
    const digits = await send(
      screenBody("classes", classForm({ startYear: "26", endYear: "20x7" })),
    );
    expect(digits.body.errors).toEqual([
      { field: "startYear", message: MESSAGES.ME517 },
      { field: "endYear", message: MESSAGES.ME517 },
    ]);
    expect(await db().schoolClass.count()).toBe(1); // seedBase のクラスだけ
  });

  it("T-MST-011 必須の欄が空なら ME501。保存されない", async () => {
    const teacher = await send(screenBody("teachers", { displayName: "  " }));
    expect(teacher.body.errors).toEqual([
      { field: "displayName", message: MESSAGES.ME501 },
    ]);
    const subject = await send(screenBody("subjects", { name: "" }));
    expect(subject.body.errors).toEqual([
      { field: "name", message: MESSAGES.ME501 },
    ]);
    const cls = await send(
      screenBody(
        "classes",
        classForm({ name: "", homeRoomId: "", startYear: "" }),
      ),
    );
    expect(cls.body.errors).toEqual([
      { field: "name", message: MESSAGES.ME501 },
      { field: "homeRoomId", message: MESSAGES.ME501 },
      { field: "startYear", message: MESSAGES.ME501 },
    ]);
    expect(await db().teacher.count()).toBe(1);
    expect(await db().subject.count()).toBe(1);
    expect(await db().schoolClass.count()).toBe(1);
  });

  it("T-MST-012 クラスのホームルーム教室に、無効な教室・存在しない教室を選ぶと ME706", async () => {
    await db().room.update({
      where: { id: ID.roomFree },
      data: { active: false },
    });
    for (const homeRoomId of [ID.roomFree, MISSING_ID]) {
      const { response, body } = await send(
        screenBody("classes", classForm({ homeRoomId })),
      );
      expect(response.status).toBe(400);
      expect(body.errors).toEqual([
        { field: "homeRoomId", message: MESSAGES.ME706 },
      ]);
    }
    expect(await db().schoolClass.count()).toBe(1);
  });
});

describe("名前の変更が、授業の表示名に伝わる(R5-3。MW501)", () => {
  const baseLesson = {
    classId: ID.classA,
    startMinutes: PERIOD.p1.start,
    endMinutes: PERIOD.p1.end,
    kind: "FIXED" as const,
  };

  it("T-MST-009b 教科の名前を変えると、今日以降の授業の教科名が変わる。過去は当時の名前のまま", async () => {
    const subject = await db().subject.findUniqueOrThrow({
      where: { name: "プログラミング" },
    });
    for (const date of ["2026-11-09", "2026-11-10", "2026-11-16"]) {
      await db().lesson.create({
        data: {
          ...baseLesson,
          date: textToDateColumn(date),
          subjectId: subject.id,
          subjectName: "プログラミング",
          roomId: ID.roomFree,
          roomName: ROOM_FREE_NAME,
        },
      });
    }
    const { body } = await send(
      screenBody(
        "subjects",
        { name: "プログラミングI" },
        {
          id: subject.id,
          version: subject.updatedAt,
        },
      ),
    );
    expect(body).toMatchObject({ notice: "MI501", renamed: true });
    const lessons = await db().lesson.findMany({
      orderBy: { date: "asc" },
      select: { subjectName: true },
    });
    expect(lessons.map((l) => l.subjectName)).toEqual([
      "プログラミング",
      "プログラミングI",
      "プログラミングI",
    ]);
  });

  it("T-MST-009c 講師の名前を変えると、今日以降の授業の講師名が変わる。過去は当時の名前のまま", async () => {
    const subject = await db().subject.findUniqueOrThrow({
      where: { name: "プログラミング" },
    });
    for (const date of ["2026-11-09", "2026-11-16"]) {
      const lesson = await db().lesson.create({
        data: {
          ...baseLesson,
          date: textToDateColumn(date),
          subjectId: subject.id,
          subjectName: "プログラミング",
          roomId: ID.roomFree,
          roomName: ROOM_FREE_NAME,
        },
      });
      await db().lessonTeacher.create({
        data: {
          lessonId: lesson.id,
          teacherName: "田村",
          teacherId: ID.teacher,
        },
      });
    }
    const teacher = await db().teacher.findUniqueOrThrow({
      where: { id: ID.teacher },
    });
    const { body } = await send(
      screenBody(
        "teachers",
        { displayName: "田村太郎" },
        {
          id: teacher.id,
          version: teacher.updatedAt,
        },
      ),
    );
    expect(body).toMatchObject({ notice: "MI501", renamed: true });
    const rows = await db().lessonTeacher.findMany({
      orderBy: { lesson: { date: "asc" } },
      select: { teacherName: true },
    });
    expect(rows.map((r) => r.teacherName)).toEqual(["田村", "田村太郎"]);
  });

  it("T-MST-009d クラスの名前を変えても、授業には写さない(授業はクラスを指す)。警告(renamed)は出る", async () => {
    await db().lesson.create({
      data: {
        ...baseLesson,
        date: textToDateColumn("2026-11-16"),
        subjectName: "プログラミング",
        roomId: ID.roomFree,
        roomName: ROOM_FREE_NAME,
      },
    });
    const row = await db().schoolClass.findUniqueOrThrow({
      where: { id: ID.classA },
    });
    const { body } = await send(
      screenBody("classes", classForm({ name: "システム専攻1年(改)" }), {
        id: row.id,
        version: row.updatedAt,
      }),
    );
    expect(body).toMatchObject({ notice: "MI501", renamed: true });
    const lessons = await db().lesson.findMany({
      where: { classId: ID.classA },
    });
    expect(lessons).toHaveLength(1);
    expect(lessons[0].subjectName).toBe("プログラミング"); // 授業の中身は変わらない
  });

  it("T-MST-009e 名前を変えない編集では、警告(renamed)は出ない", async () => {
    const row = await db().teacher.findUniqueOrThrow({
      where: { id: ID.teacher },
    });
    const { body } = await send(
      screenBody(
        "teachers",
        { displayName: "田村" },
        {
          id: row.id,
          version: row.updatedAt,
        },
      ),
    );
    expect(body).toMatchObject({ notice: "MI501", renamed: false });
  });
});

describe("先に変更された・見つからない・形が違う(14-13 #4)", () => {
  it("T-MST-010 古い版で編集すると 409(ME902)。先の変更は残る", async () => {
    const row = await db().subject.findUniqueOrThrow({
      where: { name: "プログラミング" },
    });
    const stale = row.updatedAt;
    // 別の人が先に編集した
    vi.setSystemTime(new Date("2026-11-10T10:05:00+09:00"));
    const first = await send(
      screenBody(
        "subjects",
        { name: "先の変更" },
        { id: row.id, version: stale },
      ),
    );
    expect(first.response.status).toBe(200);
    // 古い版のまま、もう一度
    const second = await send(
      screenBody(
        "subjects",
        { name: "後の変更" },
        { id: row.id, version: stale },
      ),
    );
    expect(second.response.status).toBe(409);
    expect(second.body).toEqual({ message: MESSAGES.ME902 });
    expect(
      (await db().subject.findUniqueOrThrow({ where: { id: row.id } })).name,
    ).toBe("先の変更");
  });

  it("T-MST-016 マスタの種類・ID・本文が違えば、何も保存しない(404 か 400)", async () => {
    const unknownKind = await send({ kind: "unknown", name: "x" });
    expect(unknownKind.response.status).toBe(404);
    expect(unknownKind.body).toEqual({ message: MESSAGES.ME902 });

    const badId = await send({ kind: "subjects", id: "not-a-uuid", name: "x" });
    expect(badId.response.status).toBe(404);
    const missing = await send({
      kind: "subjects",
      id: MISSING_ID,
      version: new Date().toISOString(),
      name: "x",
    });
    expect(missing.response.status).toBe(404);

    const broken = await save(request("/admin/masters/save", "{"));
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ message: SYSTEM_ERROR_MESSAGE });
    expect(await db().subject.count()).toBe(1); // seed のプログラミングだけ
  });
});

describe("無効にする・有効に戻す(R5-2)", () => {
  it("T-MST-008 4 種類とも、無効にして、有効に戻せる(MI502、MI502on)", async () => {
    const targets: [string, string][] = [
      ["rooms", ID.roomFree],
      ["teachers", ID.teacher],
      ["classes", ID.classA],
      [
        "subjects",
        (
          await db().subject.findUniqueOrThrow({
            where: { name: "プログラミング" },
          })
        ).id,
      ],
    ];
    const activeOf = async (kind: string, id: string) =>
      kind === "rooms"
        ? (await db().room.findUniqueOrThrow({ where: { id } })).active
        : kind === "teachers"
          ? (await db().teacher.findUniqueOrThrow({ where: { id } })).active
          : kind === "classes"
            ? (await db().schoolClass.findUniqueOrThrow({ where: { id } }))
                .active
            : (await db().subject.findUniqueOrThrow({ where: { id } })).active;
    for (const [kind, id] of targets) {
      const off = await toggle(kind, id, false);
      expect(off.response.status).toBe(200);
      expect(off.body).toMatchObject({ notice: "MI502", renamed: false });
      expect(await activeOf(kind, id)).toBe(false);
      const on = await toggle(kind, id, true);
      expect(on.body).toMatchObject({ notice: "MI502on" });
      expect(await activeOf(kind, id)).toBe(true);
    }
  });

  it("T-MST-008b 無効にする入り口が、見つからない・形が違うときは 404(何も変わらない)", async () => {
    const cases: [unknown, unknown, unknown][] = [
      ["rooms", MISSING_ID, false],
      ["rooms", "not-a-uuid", false],
      ["unknown", ID.roomFree, false],
      ["rooms", ID.roomFree, "false"],
    ];
    for (const [kind, id, value] of cases) {
      const { response, body } = await toggle(kind, id, value);
      expect(response.status).toBe(404);
      expect(body).toEqual({ message: MESSAGES.ME902 });
    }
    expect(
      (await db().room.findUniqueOrThrow({ where: { id: ID.roomFree } }))
        .active,
    ).toBe(true);
  });

  it("T-MST-013 ホームルーム教室を無効にすると、保存はできて、書き出し前の確認の件数(MW502 の元)が増える", async () => {
    // 基準: 何も変えない切り替えの、書き出し前の確認の件数
    const baseline = await toggle("teachers", ID.teacher, true);
    expect(baseline.response.status).toBe(200);
    const before = baseline.body.exportIssues ?? 0;

    const off = await toggle("rooms", ID.roomHome, false);
    expect(off.response.status).toBe(200);
    expect(off.body.notice).toBe("MI502");
    expect(off.body.exportIssues ?? 0).toBeGreaterThan(before);
  });
});

describe("クラスの年度(R5-4)", () => {
  it("T-MST-015 開始 2026・終了 2026 のクラスは、2026 年度にだけ存在する。終了なしは、続く", async () => {
    await send(
      screenBody("classes", classForm({ name: "一年だけ", endYear: "2026" })),
    );
    // システム専攻1年(seedBase)は、開始 2026・終了なし
    const rows = await loadImportRows(["2026-11", "2027-04"]);
    const one = rows.find((r) => r.name === "一年だけ");
    const open = rows.find((r) => r.name === "システム専攻1年");
    expect(one?.cells[0].imported).toBe("none"); // 2026 年度: 存在する
    expect(one?.cells[1].imported).toBeNull(); // 2027 年度: 存在しない
    expect(open?.cells[0].imported).toBe("none");
    expect(open?.cells[1].imported).toBe("none"); // 終了なし: 2027 年度も続く
  });
});
