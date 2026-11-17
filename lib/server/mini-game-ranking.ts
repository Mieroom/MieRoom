import "server-only";
import { z } from "zod";
import {
  canPlayMiniGame,
  DIFFICULTY_IDS,
  MODE_IDS,
  type Difficulty,
  type Mode,
} from "@/lib/domain/mini-game";
import {
  isPlausibleValue,
  normalizeNickname,
  RANKING_MESSAGES,
  RANKING_SIZE,
  type RankingBoard,
  type RankingEntry,
  type SubmitResult,
} from "@/lib/domain/mini-game-ranking";
import { getDb } from "./db";
import type { CurrentUser } from "./session";

// ミニゲームのランキング (隠し要素) のサーバー側。呼ぶ前に、ログインと「同じサイトの画面から」の確認は
// 済んでいる。ここでは、遊べる役割 (学生と時間割管理者) か、送られた値が正しい形・範囲か、を確かめる。
// 返す値には、ニックネームと記録だけを入れる (本名・メール・ユーザー ID は出さない)。

const MODES = z.enum(MODE_IDS as [Mode, ...Mode[]]);
const DIFFICULTIES = z.enum(DIFFICULTY_IDS as [Difficulty, ...Difficulty[]]);

const submitSchema = z
  .object({
    mode: MODES,
    difficulty: DIFFICULTIES,
    value: z.number(),
    nickname: z.string(),
  })
  .strict();

const boardSchema = z.object({ mode: MODES, difficulty: DIFFICULTIES });

const isDuplicate = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code: unknown }).code === "P2002";

/** 順位の付け方: 通常は点数が高い順、タイムアタックは短い順。同じなら、早く出した人が上。 */
const orderOf = (mode: Mode) =>
  [
    { value: mode === "timeattack" ? "asc" : "desc" },
    { updatedAt: "asc" },
  ] as const;

/** 自分より上の人の数 + 1 が、順位。 */
async function rankOf(
  mode: Mode,
  difficulty: Difficulty,
  value: number,
  updatedAt: Date,
): Promise<number> {
  const better = mode === "timeattack" ? { lt: value } : { gt: value };
  const above = await getDb().miniGameScore.count({
    where: {
      mode,
      difficulty,
      OR: [{ value: better }, { value, updatedAt: { lt: updatedAt } }],
    },
  });
  return above + 1;
}

/**
 * 記録を登録する。自分のベストより良いときだけ、記録とニックネームを書き換える (悪いときは、何も変えない)。
 * 1 人・モード・難易度ごとに 1 行 (一意)。同時に 2 つ来ても、悪い方で良い方を上書きしない。
 */
export async function submitScore(
  user: CurrentUser,
  body: unknown,
): Promise<SubmitResult | { kind: "forbidden" }> {
  if (!canPlayMiniGame(user.role)) return { kind: "forbidden" };
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return { kind: "invalid", message: RANKING_MESSAGES.invalid };
  }
  const { mode, difficulty, value } = parsed.data;
  const nickname = normalizeNickname(parsed.data.nickname);
  if (nickname === null) {
    return { kind: "invalid", message: RANKING_MESSAGES.nickname };
  }
  if (!isPlausibleValue(mode, difficulty, value)) {
    return { kind: "invalid", message: RANKING_MESSAGES.invalid };
  }

  const db = getDb();
  const key = { userId: user.id, mode, difficulty };
  let saved: { value: number; updatedAt: Date } | null = null;
  try {
    saved = await db.miniGameScore.create({
      data: { ...key, nickname, value },
      select: { value: true, updatedAt: true },
    });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
  }
  if (saved === null) {
    // すでに記録がある: いまの記録より良いときだけ、書き換える (1 つの命令で、比べてから書く)
    const changed = await db.miniGameScore.updateMany({
      where: {
        ...key,
        value: mode === "timeattack" ? { gt: value } : { lt: value },
      },
      data: { nickname, value },
    });
    const mine = await db.miniGameScore.findUnique({
      where: { userId_mode_difficulty: key },
      select: { value: true, updatedAt: true },
    });
    if (changed.count === 0 || mine === null) {
      return { kind: "not_best", best: mine?.value ?? value };
    }
    saved = mine;
  }
  return {
    kind: "saved",
    rank: await rankOf(mode, difficulty, saved.value, saved.updatedAt),
  };
}

/** 上位 10 人と、自分の順位。モード・難易度が正しくなければ null。 */
export async function loadBoard(
  user: CurrentUser,
  mode: unknown,
  difficulty: unknown,
): Promise<RankingBoard | null> {
  if (!canPlayMiniGame(user.role)) return null;
  const parsed = boardSchema.safeParse({ mode, difficulty });
  if (!parsed.success) return null;
  const board = parsed.data;
  const db = getDb();
  const where = { mode: board.mode, difficulty: board.difficulty };

  const top = await db.miniGameScore.findMany({
    where,
    orderBy: [...orderOf(board.mode)],
    take: RANKING_SIZE,
    select: { userId: true, nickname: true, value: true },
  });
  const entries: RankingEntry[] = top.map((row, index) => ({
    rank: index + 1,
    nickname: row.nickname,
    value: row.value,
    isMe: row.userId === user.id,
  }));

  const mine = await db.miniGameScore.findUnique({
    where: { userId_mode_difficulty: { userId: user.id, ...where } },
    select: { nickname: true, value: true, updatedAt: true },
  });
  const me: RankingEntry | null =
    mine === null
      ? null
      : {
          rank: await rankOf(
            board.mode,
            board.difficulty,
            mine.value,
            mine.updatedAt,
          ),
          nickname: mine.nickname,
          value: mine.value,
          isMe: true,
        };
  return { ...board, entries, me };
}
