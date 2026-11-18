import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, resetDatabase, testDb } from "./support/db";
import { USERS, seedBase, type TestRole } from "./support/fixtures";

// T-RANK: ミニゲームのランキング (隠し要素) を、本物の PostgreSQL で。1 人・モード・難易度ごとに 1 行、
// 良い記録だけが書き換える、順位の付け方 (点数は高い順、タイムは短い順、同じなら先に出した人)、
// 自分の順位 (上位 10 人の外でも)、ユーザーを消すと記録も消えること。

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; role: TestRole },
}));
vi.mock("@/lib/server/session", async () => {
  const { hasRole } = await import("./support/session");
  return {
    getCurrentUser: async () => session.user,
    hasRole,
    hasFreshSession: async () => true,
  };
});
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./support/db");
  return { getDb: () => testDb() };
});

import { GET as rankingRoute } from "@/app/(main)/play/ranking/route";
import { POST as scoreRoute } from "@/app/(main)/play/score/route";
import { loadBoard, submitScore } from "@/lib/server/mini-game-ranking";

const HOST = "mieroom.example";
const SAME = { "sec-fetch-site": "same-origin", host: HOST };
const post = (body: unknown) =>
  new NextRequest(`https://${HOST}/play/score`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...SAME },
  });
const get = (query: string) =>
  new NextRequest(`https://${HOST}/play/ranking${query}`, { headers: SAME });

const student = USERS.student;
const other = USERS.otherStudent;
const NORMAL = { mode: "normal", difficulty: "hard" } as const;
const TIME = { mode: "timeattack", difficulty: "normal" } as const;

beforeEach(async () => {
  await resetDatabase();
  await seedBase();
  session.user = null;
});

afterAll(async () => {
  await closeDatabase();
});

const rows = () =>
  testDb().miniGameScore.findMany({ orderBy: { createdAt: "asc" } });

describe("登録: 1 人・モード・難易度ごとに 1 行。良い記録だけが書き換える", () => {
  it("初めての記録は、新しい行になり、順位が返る", async () => {
    const result = await submitScore(student, {
      ...NORMAL,
      value: 310,
      nickname: "たろう",
    });
    expect(result).toEqual({ kind: "saved", rank: 1 });
    const saved = await rows();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      userId: student.id,
      mode: "normal",
      difficulty: "hard",
      nickname: "たろう",
      value: 310,
    });
  });
  it("通常: 高い点数だけが書き換える。同じ点・低い点は、何も変えない", async () => {
    await submitScore(student, { ...NORMAL, value: 310, nickname: "たろう" });
    expect(
      await submitScore(student, { ...NORMAL, value: 310, nickname: "ほか" }),
    ).toEqual({ kind: "not_best", best: 310 });
    expect(
      await submitScore(student, { ...NORMAL, value: 200, nickname: "ほか" }),
    ).toEqual({ kind: "not_best", best: 310 });
    expect((await rows())[0]).toMatchObject({ value: 310, nickname: "たろう" });
    expect(
      await submitScore(student, { ...NORMAL, value: 400, nickname: "じろう" }),
    ).toEqual({ kind: "saved", rank: 1 });
    // 良い記録のときは、ニックネームも新しくなる (登録のたびに入力)
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ value: 400, nickname: "じろう" });
  });
  it("タイムアタック: 短いタイムだけが書き換える", async () => {
    await submitScore(student, { ...TIME, value: 900, nickname: "はやい" });
    expect(
      await submitScore(student, { ...TIME, value: 950, nickname: "x" }),
    ).toEqual({ kind: "not_best", best: 900 });
    expect(
      await submitScore(student, { ...TIME, value: 880, nickname: "もっと" }),
    ).toEqual({ kind: "saved", rank: 1 });
    expect((await rows())[0]).toMatchObject({ value: 880, nickname: "もっと" });
  });
  it("モードと難易度ごとに、別の行 (どれも、ベストの 1 行)", async () => {
    await submitScore(student, { ...NORMAL, value: 300, nickname: "a" });
    await submitScore(student, {
      mode: "normal",
      difficulty: "easy",
      value: 300,
      nickname: "a",
    });
    await submitScore(student, { ...TIME, value: 900, nickname: "a" });
    expect(await rows()).toHaveLength(3);
  });
  it("同時に 2 つ来ても、悪い記録が良い記録を上書きしない", async () => {
    await submitScore(student, { ...NORMAL, value: 100, nickname: "a" });
    for (let round = 0; round < 5; round++) {
      await Promise.all([
        submitScore(student, {
          ...NORMAL,
          value: 500 + round,
          nickname: "good",
        }),
        submitScore(student, { ...NORMAL, value: 200, nickname: "bad" }),
        submitScore(student, { ...NORMAL, value: 300, nickname: "mid" }),
      ]);
    }
    const saved = await rows();
    expect(saved).toHaveLength(1);
    expect(saved[0].value).toBe(504);
    expect(saved[0].nickname).toBe("good");
  });
  it("先生は登録できない。何も書かれない。おかしい値も、何も書かれない", async () => {
    expect(
      await submitScore(USERS.teacher, {
        ...NORMAL,
        value: 300,
        nickname: "t",
      }),
    ).toEqual({ kind: "forbidden" });
    for (const body of [
      { ...NORMAL, value: 0, nickname: "a" },
      { ...NORMAL, value: 300, nickname: "a@b.c" },
      { ...NORMAL, value: 300, nickname: "" },
      { ...NORMAL, value: 300, nickname: "a", extra: 1 },
      { mode: "timeattack", difficulty: "hard", value: 5, nickname: "a" },
    ]) {
      expect((await submitScore(student, body)).kind).toBe("invalid");
    }
    expect(await rows()).toHaveLength(0);
  });
});

describe("ランキング: 順位と、上位 10 人", () => {
  async function seedUsers(count: number) {
    const db = testDb();
    const ids: string[] = [];
    for (let k = 0; k < count; k++) {
      const id = `u-rank-${String(k).padStart(2, "0")}`;
      await db.user.create({
        data: { id, name: `n${k}`, email: `${id}@school.example` },
      });
      ids.push(id);
    }
    return ids;
  }

  it("点数は高い順。同じ点数なら、先に出した人が上", async () => {
    await submitScore(student, { ...NORMAL, value: 300, nickname: "さき" });
    await submitScore(other, { ...NORMAL, value: 300, nickname: "あと" });
    await submitScore(USERS.admin, { ...NORMAL, value: 400, nickname: "いち" });
    const board = await loadBoard(student, "normal", "hard");
    expect(
      board?.entries.map((entry) => [entry.rank, entry.nickname, entry.value]),
    ).toEqual([
      [1, "いち", 400],
      [2, "さき", 300],
      [3, "あと", 300],
    ]);
    expect(board?.entries.map((entry) => entry.isMe)).toEqual([
      false,
      true,
      false,
    ]);
    expect(board?.me).toMatchObject({ rank: 2, nickname: "さき", value: 300 });
  });
  it("タイムアタックは、短い順", async () => {
    await submitScore(student, { ...TIME, value: 900, nickname: "ふつう" });
    await submitScore(other, { ...TIME, value: 850, nickname: "はやい" });
    const board = await loadBoard(student, "timeattack", "normal");
    expect(board?.entries.map((entry) => entry.nickname)).toEqual([
      "はやい",
      "ふつう",
    ]);
    expect(board?.me?.rank).toBe(2);
  });
  it("上位 10 人だけを出す。自分が圏外でも、自分の順位は出す", async () => {
    const ids = await seedUsers(12);
    for (const [index, id] of ids.entries()) {
      await submitScore(
        { id, name: "x", role: "student" },
        { ...NORMAL, value: 900 - index * 10, nickname: `p${index}` },
      );
    }
    await submitScore(student, { ...NORMAL, value: 50, nickname: "びり" });
    const board = await loadBoard(student, "normal", "hard");
    expect(board?.entries).toHaveLength(10);
    expect(board?.entries[0]).toMatchObject({
      rank: 1,
      nickname: "p0",
      value: 900,
    });
    expect(board?.entries[9]).toMatchObject({ rank: 10, nickname: "p9" });
    expect(board?.entries.some((entry) => entry.isMe)).toBe(false);
    expect(board?.me).toMatchObject({
      rank: 13,
      nickname: "びり",
      value: 50,
      isMe: true,
    });
  });
  it("別のモード・難易度の記録は、混ざらない。記録がなければ me は null", async () => {
    await submitScore(student, { ...NORMAL, value: 300, nickname: "a" });
    const other = await loadBoard(student, "normal", "easy");
    expect(other).toEqual({
      mode: "normal",
      difficulty: "easy",
      entries: [],
      me: null,
    });
  });
  it("先生と、おかしい指定には、出さない", async () => {
    await submitScore(student, { ...NORMAL, value: 300, nickname: "a" });
    expect(await loadBoard(USERS.teacher, "normal", "hard")).toBeNull();
    expect(await loadBoard(student, "x", "hard")).toBeNull();
    expect(await loadBoard(student, "normal", "x")).toBeNull();
    expect(await loadBoard(student, undefined, null)).toBeNull();
  });
});

describe("入り口 (ルート) と、データの扱い", () => {
  it("ルートから登録し、ランキングで読める。返すのはニックネームと記録と順位だけ", async () => {
    session.user = student;
    const saved = await scoreRoute(
      post({ ...NORMAL, value: 310, nickname: "たろう" }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ kind: "saved", rank: 1 });
    const response = await rankingRoute(get("?mode=normal&difficulty=hard"));
    const text = JSON.stringify(await response.json());
    expect(text).toContain("たろう");
    expect(text).not.toContain(student.id);
    expect(text).not.toContain(student.name);
    expect(text).not.toContain("@");
  });
  it("先生は、ルートでも 404。ログインしていなければ 401", async () => {
    session.user = USERS.teacher;
    expect(
      (await scoreRoute(post({ ...NORMAL, value: 310, nickname: "t" }))).status,
    ).toBe(404);
    expect(
      (await rankingRoute(get("?mode=normal&difficulty=hard"))).status,
    ).toBe(404);
    session.user = null;
    expect(
      (await scoreRoute(post({ ...NORMAL, value: 310, nickname: "t" }))).status,
    ).toBe(401);
    expect(await rows()).toHaveLength(0);
  });
  it("ユーザーを消すと、記録も一緒に消える (デモのあとの DELETE FROM users)", async () => {
    await submitScore(student, { ...NORMAL, value: 310, nickname: "たろう" });
    await submitScore(other, { ...NORMAL, value: 200, nickname: "じろう" });
    await testDb().user.delete({ where: { id: student.id } });
    const left = await rows();
    expect(left).toHaveLength(1);
    expect(left[0].nickname).toBe("じろう");
  });
  it("同じ人・モード・難易度の行は、データベースが 2 つ作らせない", async () => {
    const db = testDb();
    const data = {
      userId: student.id,
      mode: "normal",
      difficulty: "hard",
      nickname: "a",
      value: 1,
    };
    await db.miniGameScore.create({ data });
    await expect(db.miniGameScore.create({ data })).rejects.toMatchObject({
      code: "P2002",
    });
  });
});
