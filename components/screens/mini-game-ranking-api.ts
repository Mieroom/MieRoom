import type { Difficulty, Mode } from "@/lib/domain/mini-game";
import {
  isBetter,
  RANKING_MESSAGES,
  RANKING_SIZE,
  type RankingBoard,
  type RankingEntry,
} from "@/lib/domain/mini-game-ranking";

// ランキングの画面が使う、記録の読み書き。本物はサーバー (/play/ranking と /play/score) を呼ぶ。
// 見本画面 (ログインなしの /_dev) だけは、メモリの中の見本を使う (サーバーも DB も使わない)。

export type SubmitInput = {
  mode: Mode;
  difficulty: Difficulty;
  value: number;
  nickname: string;
};

export type SubmitResponse =
  | { kind: "saved"; rank: number }
  | { kind: "not_best"; best: number }
  | { kind: "error"; message: string };

export type RankingApi = {
  load(mode: Mode, difficulty: Difficulty): Promise<RankingBoard | null>;
  submit(input: SubmitInput): Promise<SubmitResponse>;
};

const FAILED = "通信に失敗しました。もう一度お試しください。";

/** サーバーの返事の本文を読む。読めなければ null (内部の情報は、画面に出さない)。 */
async function readBody(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const serverApi: RankingApi = {
  async load(mode, difficulty) {
    try {
      const query = new URLSearchParams({ mode, difficulty });
      const response = await fetch(`/play/ranking?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) return null;
      return (await response.json()) as RankingBoard;
    } catch {
      return null;
    }
  },
  async submit(input) {
    try {
      const response = await fetch("/play/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await readBody(response);
      if (
        response.ok &&
        body?.kind === "saved" &&
        typeof body.rank === "number"
      ) {
        return { kind: "saved", rank: body.rank };
      }
      if (
        response.ok &&
        body?.kind === "not_best" &&
        typeof body.best === "number"
      ) {
        return { kind: "not_best", best: body.best };
      }
      return {
        kind: "error",
        message: typeof body?.message === "string" ? body.message : FAILED,
      };
    } catch {
      return { kind: "error", message: FAILED };
    }
  },
};

// ---------------------------------------------------------------- 見本 (メモリの中だけ)

const SAMPLE_NAMES = [
  "はやと",
  "みく",
  "そうた",
  "ひなた",
  "れん",
  "あおい",
  "ゆうき",
  "さくら",
];

/** 見本のランキング: 呼ぶたびに、同じ並び。自分の記録だけが、登録で増える。 */
export function createDemoApi(): RankingApi {
  const mine = new Map<string, { nickname: string; value: number }>();
  const key = (mode: Mode, difficulty: Difficulty) => `${mode}.${difficulty}`;
  const others = (mode: Mode, difficulty: Difficulty): RankingEntry[] =>
    SAMPLE_NAMES.map((nickname, index) => ({
      rank: 0,
      nickname,
      value:
        mode === "timeattack"
          ? 480 + index * 35 + (difficulty === "hard" ? 120 : 0)
          : 640 - index * 55 - (difficulty === "hard" ? 90 : 0),
      isMe: false,
    }));
  return {
    async load(mode, difficulty) {
      const own = mine.get(key(mode, difficulty));
      const list = others(mode, difficulty);
      if (own) list.push({ rank: 0, ...own, isMe: true });
      list.sort((a, b) =>
        mode === "timeattack" ? a.value - b.value : b.value - a.value,
      );
      const ranked = list.map((entry, index) => ({
        ...entry,
        rank: index + 1,
      }));
      return {
        mode,
        difficulty,
        entries: ranked.slice(0, RANKING_SIZE),
        me: ranked.find((entry) => entry.isMe) ?? null,
      };
    },
    async submit(input) {
      const current = mine.get(key(input.mode, input.difficulty));
      if (current && !isBetter(input.mode, input.value, current.value)) {
        return { kind: "not_best", best: current.value };
      }
      const nickname = input.nickname.trim();
      if (nickname === "" || nickname.length > 12) {
        return { kind: "error", message: RANKING_MESSAGES.nickname };
      }
      mine.set(key(input.mode, input.difficulty), {
        nickname,
        value: input.value,
      });
      const board = await this.load(input.mode, input.difficulty);
      return { kind: "saved", rank: board?.me?.rank ?? 1 };
    },
  };
}
