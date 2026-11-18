import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeRequesterName,
  REQUESTER_NAME_MAX,
} from "@/lib/domain/reservation-core";
import { applicantText } from "@/lib/domain/reservation-text";
import { LOGIN_ERROR_MESSAGES, MESSAGES } from "@/lib/messages";

// 代理入力 (S12) の依頼者: 名前の規則、一覧の文、生徒の検索 (先生・管理者を出さない)、入り口。

vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  adminEmail: { findMany: vi.fn() },
  teacherEmail: { findMany: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/lib/server/db", () => ({ getDb: () => db }));
const env = vi.hoisted(() => ({
  value: {
    INITIAL_ADMIN_EMAIL: "boss@school.example",
    STUDENT_EMAIL_PATTERN: /^(?:[0-9]{6})$/ as RegExp,
  },
}));
vi.mock("@/lib/server/env", () => ({ getEnv: () => env.value }));
const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/server/session", () => ({
  getCurrentUser: session.getCurrentUser,
  hasRole: (user: { role: string }, role: string) =>
    role === "admin"
      ? user.role === "admin"
      : role === "teacher"
        ? user.role !== "student"
        : true,
}));

import { POST as searchRoute } from "@/app/(main)/teacher/reservations/requesters/route";
import {
  findSelectableStudent,
  normalizeQuery,
  searchRequesters,
} from "@/lib/server/requesters";

describe("依頼者の名前 (文字で入れたもの)", () => {
  it("前後の空白と制御文字を取り、1〜20文字なら受け付ける", () => {
    expect(normalizeRequesterName("  大学併修2年 山田 ")).toEqual({
      ok: true,
      value: "大学併修2年 山田",
    });
    expect(
      normalizeRequesterName("あ".repeat(REQUESTER_NAME_MAX)),
    ).toMatchObject({
      ok: true,
    });
    expect(normalizeRequesterName("山\u0000田\u0007")).toEqual({
      ok: true,
      value: "山田",
    });
  });
  it("空・空白・制御文字だけ・文字でないものは ME501。21文字からは ME504", () => {
    for (const value of ["", "  ", "\u0000\t\n", null, undefined, 5]) {
      expect(normalizeRequesterName(value), String(value)).toEqual({
        ok: false,
        code: "ME501",
      });
    }
    expect(normalizeRequesterName("あ".repeat(21))).toEqual({
      ok: false,
      code: "ME504",
    });
  });
  it("絵文字なども、1文字として数える (20文字まで)", () => {
    expect(normalizeRequesterName("😀".repeat(20))).toMatchObject({ ok: true });
    expect(normalizeRequesterName("😀".repeat(21))).toMatchObject({
      ok: false,
      code: "ME504",
    });
  });
});

describe("一覧の「申請者」の文 (applicantText)", () => {
  const base = {
    applicantName: "山田 太郎",
    requesterName: null,
    handledByName: "田村 先生",
  };
  it("代理入力でなければ、申請者の名前だけ", () => {
    expect(applicantText({ ...base, proxy: false })).toBe("山田 太郎");
  });
  it("文字で入れた依頼者: 依頼者(代理入力: 先生)", () => {
    expect(
      applicantText({
        proxy: true,
        applicantName: "田村 先生",
        requesterName: "大学併修2年 山田",
        handledByName: "田村 先生",
      }),
    ).toBe("大学併修2年 山田(代理入力: 田村 先生)");
  });
  it("生徒を選んだもの: 生徒(代理入力: 先生)", () => {
    expect(applicantText({ ...base, proxy: true })).toBe(
      "山田 太郎(代理入力: 田村 先生)",
    );
  });
  it("以前の代理入力 (申請者と対応した先生が同じ) は、重ねて書かない", () => {
    expect(
      applicantText({
        proxy: true,
        applicantName: "田村 先生",
        requesterName: null,
        handledByName: "田村 先生",
      }),
    ).toBe("田村 先生(代理入力)");
    expect(
      applicantText({
        proxy: true,
        applicantName: "田村 先生",
        requesterName: null,
        handledByName: null,
      }),
    ).toBe("田村 先生(代理入力)");
  });
});

describe("検索のことば", () => {
  it("2〜20文字。前後の空白と制御文字は取る。合わなければ null", () => {
    expect(normalizeQuery(" 山田 ")).toBe("山田");
    expect(normalizeQuery("山\u0000田")).toBe("山田");
    for (const value of ["", "山", " 山 ", "あ".repeat(21), null, 3, {}]) {
      expect(normalizeQuery(value), String(value)).toBeNull();
    }
  });
});

describe("生徒の検索 (searchRequesters)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.value = {
      INITIAL_ADMIN_EMAIL: "boss@school.example",
      STUDENT_EMAIL_PATTERN: /^(?:[0-9]{6})$/,
    };
    db.adminEmail.findMany.mockResolvedValue([
      { email: "admin@school.example" },
    ]);
  });

  it("短いことば・形の違うことばは、DB に問い合わせずに空", async () => {
    expect(await searchRequesters("山", "t1")).toEqual([]);
    expect(await searchRequesters(undefined, "t1")).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("名前だけを返す。メール・先生・管理者・最初の管理者は出さない", async () => {
    db.user.findMany.mockResolvedValue([
      { id: "u1", name: "山田 太郎", email: "234001@school.example" },
      { id: "u2", name: "山田 先生", email: "tamura@school.example" },
      { id: "u3", name: "山田 管理", email: "admin@school.example" },
      { id: "u4", name: "山田 最初", email: "boss@school.example" },
      { id: "u5", name: "山田 花子", email: "234002@school.example" },
    ]);
    const found = await searchRequesters("山田", "t1");
    expect(found).toEqual([
      { id: "u1", name: "山田 太郎" },
      { id: "u5", name: "山田 花子" },
    ]);
    expect(JSON.stringify(found)).not.toMatch(/@/);
    const query = db.user.findMany.mock.calls[0][0];
    expect(query.where.name).toEqual({ contains: "山田", mode: "insensitive" });
    expect(query.where.id).toEqual({ not: "t1" });
    expect(query.select).toEqual({ id: true, name: true, email: true });
    expect(query.take).toBeGreaterThanOrEqual(10);
  });

  it("最大10人まで", async () => {
    db.user.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        id: `u${i}`,
        name: `山田${i}`,
        email: `${230000 + i}@school.example`,
      })),
    );
    expect(await searchRequesters("山田", "t1")).toHaveLength(10);
  });

  it("学生の形 (STUDENT_EMAIL_PATTERN) に合う人だけが生徒 (管理者の指定がなくても、それ以外は先生)", async () => {
    env.value = {
      INITIAL_ADMIN_EMAIL: "",
      STUDENT_EMAIL_PATTERN: /^\d{6}$/,
    };
    db.user.findMany.mockResolvedValue([
      { id: "u1", name: "山田 太郎", email: "234001@school.example" },
      { id: "u2", name: "山田 先生", email: "tamura@school.example" },
    ]);
    expect(await searchRequesters("山田", "t1")).toEqual([
      { id: "u1", name: "山田 太郎" },
    ]);
  });
});

describe("先生として登録したメール (テスト用) は、生徒ではない", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.value = {
      INITIAL_ADMIN_EMAIL: "boss@school.example",
      STUDENT_EMAIL_PATTERN: /^(?:[0-9]{6})$/,
    };
    db.adminEmail.findMany.mockResolvedValue([]);
    db.teacherEmail.findMany.mockResolvedValue([
      { email: "234001@school.example" },
    ]);
  });

  afterEach(() => {
    db.teacherEmail.findMany.mockResolvedValue([]);
  });

  it("学生の形でも、登録していれば、検索に出ない", async () => {
    db.user.findMany.mockResolvedValue([
      { id: "u1", name: "山田 太郎", email: "234001@school.example" },
      { id: "u5", name: "山田 花子", email: "234002@school.example" },
    ]);
    expect(await searchRequesters("山田", "t1")).toEqual([
      { id: "u5", name: "山田 花子" },
    ]);
  });

  it("学生の形でも、登録していれば、選べない", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "山田 太郎",
      email: "234001@school.example",
    });
    expect(await findSelectableStudent("u1", "t1")).toBeNull();
  });
});

describe("選んだ生徒の確認 (findSelectableStudent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.value = {
      INITIAL_ADMIN_EMAIL: "boss@school.example",
      STUDENT_EMAIL_PATTERN: /^(?:[0-9]{6})$/,
    };
    db.adminEmail.findMany.mockResolvedValue([]);
  });

  it("いる生徒なら、ID と名前だけを返す", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "山田 太郎",
      email: "234001@school.example",
    });
    expect(await findSelectableStudent("u1", "t1")).toEqual({
      id: "u1",
      name: "山田 太郎",
    });
  });
  it("いない・先生・先生本人・長すぎる ID は null", async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect(await findSelectableStudent("nobody", "t1")).toBeNull();
    db.user.findUnique.mockResolvedValue({
      id: "u2",
      name: "田村 先生",
      email: "tamura@school.example",
    });
    expect(await findSelectableStudent("u2", "t1")).toBeNull();
    db.user.findUnique.mockClear();
    expect(await findSelectableStudent("t1", "t1")).toBeNull();
    expect(await findSelectableStudent("x".repeat(65), "t1")).toBeNull();
    expect(await findSelectableStudent("", "t1")).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("依頼者の検索の入り口 (先生だけ)", () => {
  const HOST = "mieroom.example";
  const SAME = { "sec-fetch-site": "same-origin", host: HOST };
  const post = (body: unknown, headers: Record<string, string> = SAME) =>
    new NextRequest(`https://${HOST}/teacher/reservations/requesters`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    });
  const as = (role: "student" | "teacher" | "admin" | null) =>
    session.getCurrentUser.mockResolvedValue(
      role === null ? null : { id: "t1", name: "田村 先生", role },
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    env.value = {
      INITIAL_ADMIN_EMAIL: "",
      STUDENT_EMAIL_PATTERN: /^(?:[0-9]{6})$/,
    };
    db.adminEmail.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([
      { id: "u1", name: "山田 太郎", email: "234001@school.example" },
    ]);
  });

  it("学生は 403 (ME004)、ログインなしは 401 (ME005)。何も検索しない", async () => {
    as("student");
    const forbidden = await searchRoute(post({ q: "山田" }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ message: MESSAGES.ME004 });
    as(null);
    const none = await searchRoute(post({ q: "山田" }));
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ message: LOGIN_ERROR_MESSAGES.ME005 });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("同じサイトの画面からだけ", async () => {
    as("teacher");
    for (const headers of [
      { "sec-fetch-site": "cross-site", host: HOST },
      { host: HOST },
      { origin: "https://evil.example", host: HOST },
    ] as Record<string, string>[]) {
      expect((await searchRoute(post({ q: "山田" }, headers))).status).toBe(
        403,
      );
    }
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("先生 (時間割管理者も) は、名前だけの一覧を受け取る。キャッシュさせない", async () => {
    for (const role of ["teacher", "admin"] as const) {
      as(role);
      const response = await searchRoute(post({ q: "山田" }));
      expect(response.status, role).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        people: [{ id: "u1", name: "山田 太郎" }],
      });
    }
  });

  it("本文が不正でも、DB の失敗でも、内部の情報を出さない", async () => {
    as("teacher");
    const bad = await searchRoute(
      new NextRequest(`https://${HOST}/teacher/reservations/requesters`, {
        method: "POST",
        body: "{not json",
        headers: { "content-type": "application/json", ...SAME },
      }),
    );
    expect(bad.status).toBe(400);
    db.user.findMany.mockRejectedValue(new Error("prisma: connection refused"));
    const failed = await searchRoute(post({ q: "山田" }));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toMatch(
      /prisma|connection/i,
    );
  });

  it("ことばがなければ、空の一覧", async () => {
    as("teacher");
    const response = await searchRoute(post({}));
    expect(await response.json()).toEqual({ people: [] });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
