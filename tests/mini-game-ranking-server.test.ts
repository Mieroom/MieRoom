import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RANKING_MESSAGES } from "@/lib/domain/mini-game-ranking";
import {
  LOGIN_ERROR_MESSAGES,
  MESSAGES,
  SYSTEM_ERROR_MESSAGE,
} from "@/lib/messages";

// ミニゲームのランキング (隠し要素) の入り口とサーバー側: 誰が使えるか、何が返るか。
// ログインと DB は置き換える。ルートとサーバー関数は、本物。

vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({
  miniGameScore: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));
vi.mock("@/lib/server/db", () => ({ getDb: () => db }));
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

import { GET as rankingRoute } from "@/app/(main)/play/ranking/route";
import { POST as scoreRoute } from "@/app/(main)/play/score/route";

const HOST = "mieroom.example";
const SAME = { "sec-fetch-site": "same-origin", host: HOST };
const post = (body: unknown, headers: Record<string, string> = SAME) =>
  new NextRequest(`https://${HOST}/play/score`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
const get = (query: string, headers: Record<string, string> = SAME) =>
  new NextRequest(`https://${HOST}/play/ranking${query}`, { headers });

const as = (role: "student" | "teacher" | "admin" | null) =>
  session.getCurrentUser.mockResolvedValue(
    role === null ? null : { id: "u1", name: "山田 太郎", role },
  );

const GOOD = {
  mode: "normal",
  difficulty: "hard",
  value: 310,
  nickname: "たろう",
};
const NOW = new Date("2026-11-17T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  as("student");
  db.miniGameScore.create.mockResolvedValue({ value: 310, updatedAt: NOW });
  db.miniGameScore.count.mockResolvedValue(2);
  db.miniGameScore.findUnique.mockResolvedValue(null);
  db.miniGameScore.findMany.mockResolvedValue([]);
  db.miniGameScore.updateMany.mockResolvedValue({ count: 0 });
});

describe("記録の登録 (POST /play/score): 入り口", () => {
  it("同じサイトの画面からだけ受ける", async () => {
    const others: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site", host: HOST },
      { "sec-fetch-site": "same-site", host: HOST },
      { host: HOST },
      { origin: "https://evil.example", host: HOST },
    ];
    for (const headers of others) {
      const response = await scoreRoute(post(GOOD, headers));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ message: MESSAGES.ME004 });
    }
    expect(db.miniGameScore.create).not.toHaveBeenCalled();
  });
  it("ログインしていなければ 401", async () => {
    as(null);
    const response = await scoreRoute(post(GOOD));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      message: LOGIN_ERROR_MESSAGES.ME005,
    });
    expect(db.miniGameScore.create).not.toHaveBeenCalled();
  });
  it("先生は、ないものとして 404。何も書かない", async () => {
    as("teacher");
    const response = await scoreRoute(post(GOOD));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: SYSTEM_ERROR_MESSAGE });
    expect(db.miniGameScore.create).not.toHaveBeenCalled();
    expect(db.miniGameScore.updateMany).not.toHaveBeenCalled();
  });
  it("読めない本文は 400、大きすぎる本文は 413。応答は保存させない", async () => {
    expect((await scoreRoute(post("{not json"))).status).toBe(400);
    expect(
      (await scoreRoute(post({ ...GOOD, nickname: "x".repeat(20_000) })))
        .status,
    ).toBe(413);
    const ok = await scoreRoute(post(GOOD));
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });
});

describe("記録の登録: 値の確認と書き込み", () => {
  it("学生と時間割管理者は、登録できる。書くのは、ログイン中の本人の行だけ", async () => {
    for (const role of ["student", "admin"] as const) {
      as(role);
      db.miniGameScore.create.mockClear();
      const response = await scoreRoute(
        post({ ...GOOD, userId: "someone-else" }), // 余計な項目は、受けない
      );
      expect(response.status).toBe(400);
      const ok = await scoreRoute(post(GOOD));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ kind: "saved", rank: 3 });
      expect(db.miniGameScore.create).toHaveBeenCalledWith({
        data: {
          userId: "u1",
          mode: "normal",
          difficulty: "hard",
          nickname: "たろう",
          value: 310,
        },
        select: { value: true, updatedAt: true },
      });
    }
  });
  it("ニックネームは整えて保存する。使えない名前は 400 で、何も書かない", async () => {
    await scoreRoute(post({ ...GOOD, nickname: "  ＡＢＣ  " }));
    expect(db.miniGameScore.create.mock.calls[0][0].data.nickname).toBe("ABC");
    db.miniGameScore.create.mockClear();
    for (const nickname of ["", "あ".repeat(13), "a@b.c", "http://x", "a​b"]) {
      const response = await scoreRoute(post({ ...GOOD, nickname }));
      expect(response.status, nickname).toBe(400);
      expect(await response.json()).toEqual({
        message: RANKING_MESSAGES.nickname,
      });
    }
    expect(db.miniGameScore.create).not.toHaveBeenCalled();
  });
  it("形や範囲がおかしい値は 400 (モード・難易度・記録・余計な項目)", async () => {
    const bad: unknown[] = [
      { ...GOOD, mode: "other" },
      { ...GOOD, difficulty: "extreme" },
      { ...GOOD, value: "310" },
      { ...GOOD, value: 0 },
      { ...GOOD, value: 1001 },
      { ...GOOD, value: 12.5 },
      { ...GOOD, mode: "timeattack", value: 10 }, // 速すぎる
      { ...GOOD, mode: "timeattack", value: 99_999 }, // 遅すぎる
      { mode: "normal", difficulty: "hard", value: 310 }, // ニックネームなし
      { ...GOOD, extra: 1 },
      [],
      null,
      "x",
      42,
    ];
    for (const body of bad) {
      const response = await scoreRoute(post(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(db.miniGameScore.create).not.toHaveBeenCalled();
    expect(db.miniGameScore.updateMany).not.toHaveBeenCalled();
  });
  it("すでに記録があるときは、良い記録のときだけ書き換える", async () => {
    const duplicate = Object.assign(new Error("dup"), { code: "P2002" });
    db.miniGameScore.create.mockRejectedValue(duplicate);
    // 良い記録: 書き換わる
    db.miniGameScore.updateMany.mockResolvedValue({ count: 1 });
    db.miniGameScore.findUnique.mockResolvedValue({
      value: 310,
      updatedAt: NOW,
    });
    const better = await scoreRoute(post(GOOD));
    expect(await better.json()).toEqual({ kind: "saved", rank: 3 });
    expect(db.miniGameScore.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        mode: "normal",
        difficulty: "hard",
        value: { lt: 310 },
      },
      data: { nickname: "たろう", value: 310 },
    });
    // 良くない記録: 何も変えず、いまのベストを知らせる
    db.miniGameScore.updateMany.mockResolvedValue({ count: 0 });
    db.miniGameScore.findUnique.mockResolvedValue({
      value: 500,
      updatedAt: NOW,
    });
    const worse = await scoreRoute(post(GOOD));
    expect(worse.status).toBe(200);
    expect(await worse.json()).toEqual({ kind: "not_best", best: 500 });
  });
  it("タイムアタックは、短いほど良い (比べる向きが逆)", async () => {
    const duplicate = Object.assign(new Error("dup"), { code: "P2002" });
    db.miniGameScore.create.mockRejectedValue(duplicate);
    db.miniGameScore.updateMany.mockResolvedValue({ count: 1 });
    db.miniGameScore.findUnique.mockResolvedValue({
      value: 800,
      updatedAt: NOW,
    });
    db.miniGameScore.count.mockResolvedValue(0);
    const response = await scoreRoute(
      post({
        mode: "timeattack",
        difficulty: "normal",
        value: 800,
        nickname: "はやい",
      }),
    );
    expect(await response.json()).toEqual({ kind: "saved", rank: 1 });
    expect(db.miniGameScore.updateMany.mock.calls[0][0].where.value).toEqual({
      gt: 800,
    });
  });
  it("重複以外のデータベースの失敗は、内部の情報を出さずに 500", async () => {
    db.miniGameScore.create.mockRejectedValue(
      new Error("connection string leaked"),
    );
    const response = await scoreRoute(post(GOOD));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: SYSTEM_ERROR_MESSAGE });
  });
});

describe("ランキングの取得 (GET /play/ranking)", () => {
  it("同じサイトの画面からだけ。ログインがなければ 401。先生と、おかしい指定は 404", async () => {
    expect(
      (await rankingRoute(get("?mode=normal&difficulty=hard", { host: HOST })))
        .status,
    ).toBe(404);
    as(null);
    expect(
      (await rankingRoute(get("?mode=normal&difficulty=hard"))).status,
    ).toBe(401);
    as("teacher");
    expect(
      (await rankingRoute(get("?mode=normal&difficulty=hard"))).status,
    ).toBe(404);
    as("student");
    for (const query of [
      "",
      "?mode=normal",
      "?mode=x&difficulty=hard",
      "?mode=normal&difficulty=zzz",
    ]) {
      expect((await rankingRoute(get(query))).status, query).toBe(404);
    }
    expect(db.miniGameScore.findMany).not.toHaveBeenCalled();
  });
  it("上位と自分の順位を返す。ユーザー ID・メール・本名は、返さない", async () => {
    db.miniGameScore.findMany.mockResolvedValue([
      { userId: "u9", nickname: "いちばん", value: 600 },
      { userId: "u1", nickname: "たろう", value: 310 },
    ]);
    db.miniGameScore.findUnique.mockResolvedValue({
      nickname: "たろう",
      value: 310,
      updatedAt: NOW,
    });
    db.miniGameScore.count.mockResolvedValue(1);
    const response = await rankingRoute(get("?mode=normal&difficulty=hard"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      mode: "normal",
      difficulty: "hard",
      entries: [
        { rank: 1, nickname: "いちばん", value: 600, isMe: false },
        { rank: 2, nickname: "たろう", value: 310, isMe: true },
      ],
      me: { rank: 2, nickname: "たろう", value: 310, isMe: true },
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain("u9");
    expect(text).not.toContain('u1"');
    expect(text).not.toContain("山田");
    expect(db.miniGameScore.findMany).toHaveBeenCalledWith({
      where: { mode: "normal", difficulty: "hard" },
      orderBy: [{ value: "desc" }, { updatedAt: "asc" }],
      take: 10,
      select: { userId: true, nickname: true, value: true },
    });
  });
  it("タイムアタックは、短い順に並べる。記録がなければ me は null", async () => {
    await rankingRoute(get("?mode=timeattack&difficulty=easy"));
    expect(db.miniGameScore.findMany.mock.calls[0][0].orderBy).toEqual([
      { value: "asc" },
      { updatedAt: "asc" },
    ]);
    const response = await rankingRoute(
      get("?mode=timeattack&difficulty=easy"),
    );
    expect((await response.json()).me).toBeNull();
  });
  it("データベースの失敗は、内部の情報を出さずに 500", async () => {
    db.miniGameScore.findMany.mockRejectedValue(new Error("password=hunter2"));
    const response = await rankingRoute(get("?mode=normal&difficulty=hard"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
  });
});
