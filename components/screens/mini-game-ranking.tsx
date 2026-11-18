"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DIFFICULTIES,
  MODE_NAMES,
  type Difficulty,
  type Mode,
} from "@/lib/domain/mini-game";
import {
  formatValue,
  NICKNAME_MAX,
  type RankingBoard,
} from "@/lib/domain/mini-game-ranking";
import type { RankingApi, SubmitResponse } from "./mini-game-ranking-api";

// ミニゲームのランキング (隠し要素): 上位 10 人と自分の順位 (ゲーム画面の下)、ゴールしたあとの登録の入力欄
// (終わったあとの画面の中)。表に出るのは、ニックネームと記録だけ。ニックネームは、登録のたびに入れる
// (前回の名前を入れておく。直せる)。

const NICKNAME_KEY = "mieroom.miniGame.nickname";

function readNickname(): string {
  try {
    return window.localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeNickname(value: string) {
  try {
    window.localStorage.setItem(NICKNAME_KEY, value);
  } catch {
    // 保存できなくても、使える
  }
}

// 前回のニックネーム (この端末に覚えたもの)。サーバーで作るときは空で、ブラウザで読み直す
const noSubscribe = () => () => {};

/** 登録できる、ゴールした記録 (1 回のプレイにつき 1 つ。id が変わると、新しいプレイ)。 */
export type FinishedRun = {
  id: number;
  mode: Mode;
  difficulty: Difficulty;
  /** 通常は点数、タイムアタックは 0.1 秒の数 */
  value: number;
};

/** 登録の結果の文 (終わったあとの画面に出す)。 */
export function registerNotice(
  run: FinishedRun,
  result: SubmitResponse,
): string {
  if (result.kind === "saved") return `登録しました。${result.rank} 位です。`;
  if (result.kind === "not_best") {
    return `自分のベスト (${formatValue(run.mode, result.best)}) を超えていないので、登録しませんでした。`;
  }
  return result.message;
}

/**
 * 登録の入力欄: ニックネームを入れて、登録する。登録できたとき (または、ベストを超えていなくて登録しなかったとき)
 * に onDone を呼ぶ。通信の失敗や、使えない名前のときは、ここに文を出して、直してもう一度できる。
 */
export function RankingRegister({
  api,
  run,
  onDone,
}: {
  api: RankingApi;
  run: FinishedRun;
  onDone: (result: SubmitResponse) => void;
}) {
  const remembered = useSyncExternalStore(noSubscribe, readNickname, () => "");
  const [edited, setEdited] = useState<string | null>(null);
  const nickname = edited ?? remembered;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (sending) return;
    setSending(true);
    setError(null);
    const result = await api.submit({
      mode: run.mode,
      difficulty: run.difficulty,
      value: run.value,
      nickname,
    });
    setSending(false);
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    if (result.kind === "saved") writeNickname(nickname.trim());
    onDone(result);
  }

  return (
    <form
      className="flex flex-col items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col items-center gap-1 text-xs">
        ニックネーム (1〜{NICKNAME_MAX} 文字)
        <input
          value={nickname}
          onChange={(event) => setEdited(event.target.value)}
          maxLength={NICKNAME_MAX * 2}
          autoComplete="off"
          spellCheck={false}
          className="h-10 w-56 rounded-md border border-white/40 bg-white px-3 text-base text-[#1f2a44] sm:text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={sending}
        className="rounded-md bg-[#ffe066] px-4 py-1.5 text-sm font-bold text-[#1f2a44] hover:bg-white disabled:opacity-60"
      >
        ランキングに登録
      </button>
      {error !== null && (
        <p role="alert" className="text-xs text-[#ff9aa5]">
          {error}
        </p>
      )}
    </form>
  );
}

/** 上位 10 人と、自分の順位 (圏外でも出す)。reload が増えるたびに、読み直す。 */
export function MiniGameRanking({
  api,
  mode,
  difficulty,
  reload,
}: {
  api: RankingApi;
  /** 表に出すランキング (いま選んでいるモードと難易度) */
  mode: Mode;
  difficulty: Difficulty;
  reload: number;
}) {
  // 読み込んだランキング。どの条件で読んだか (key) も持つ: 条件が変わったら、読み込み中になる
  const [loaded, setLoaded] = useState<{
    key: string;
    board: RankingBoard | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);

  const wanted = `${mode}.${difficulty}.${reload}.${retry}`;
  useEffect(() => {
    let cancelled = false;
    api.load(mode, difficulty).then((next) => {
      if (!cancelled) setLoaded({ key: wanted, board: next });
    });
    return () => {
      cancelled = true;
    };
  }, [api, mode, difficulty, wanted]);
  const state =
    loaded?.key !== wanted ? "loading" : loaded.board ? "ready" : "failed";
  // 別のモード・難易度の表は、出さない (記録の単位が違うため)
  const shown =
    loaded?.board &&
    loaded.board.mode === mode &&
    loaded.board.difficulty === difficulty
      ? loaded.board
      : null;
  const inTop = shown?.entries.some((entry) => entry.isMe) ?? false;

  return (
    <section
      aria-label="ランキング"
      className="rounded-[11px] border border-line p-3 sm:p-4"
    >
      <h2 className="text-sm font-semibold">
        ランキング
        <span className="ml-2 text-xs font-normal text-muted">
          {MODE_NAMES[mode]}・{DIFFICULTIES[difficulty].name}
        </span>
      </h2>

      {state === "failed" && (
        <p className="mt-3 text-xs">
          ランキングを読み込めませんでした。
          <button
            type="button"
            onClick={() => setRetry((count) => count + 1)}
            className="ml-2 underline"
          >
            もう一度読み込む
          </button>
        </p>
      )}
      {state === "loading" && shown === null && (
        <p className="mt-3 text-xs text-muted">読み込み中…</p>
      )}
      {shown !== null &&
        (shown.entries.length === 0 ? (
          <p className="mt-3 text-xs text-muted">まだ、記録がありません。</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-1 text-xs">
            {shown.entries.map((entry) => (
              <Row key={entry.rank} entry={entry} mode={mode} />
            ))}
            {shown.me !== null && !inTop && (
              <>
                <li aria-hidden="true" className="text-center text-muted">
                  …
                </li>
                <Row entry={shown.me} mode={mode} />
              </>
            )}
          </ol>
        ))}
    </section>
  );
}

function Row({
  entry,
  mode,
}: {
  entry: RankingBoard["entries"][number];
  mode: Mode;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${
        entry.isMe ? "bg-[#fff6d6] font-semibold" : "bg-[#f6f8fc]"
      }`}
    >
      <span className="w-8 text-right tabular-nums">{entry.rank}位</span>
      <span className="min-w-0 flex-1 truncate">
        {entry.nickname}
        {entry.isMe && <span className="ml-2 text-[11px]">(あなた)</span>}
      </span>
      <span className="tabular-nums">{formatValue(mode, entry.value)}</span>
    </li>
  );
}
