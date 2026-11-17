"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/form";
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
import type { RankingApi } from "./mini-game-ranking-api";

// ミニゲームのランキング (隠し要素): 上位 10 人と自分の順位、ゴールしたあとの登録。
// 表に出るのは、ニックネームと記録だけ。ニックネームは、登録のたびに入れる (前回の名前を入れておく)。

const NICKNAME_KEY = "mieroom.miniGame.nickname";

function readNickname(): string {
  try {
    return window.localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

// 前回のニックネーム (この端末に覚えたもの)。サーバーで作るときは空で、ブラウザで読み直す
const noSubscribe = () => () => {};

function writeNickname(value: string) {
  try {
    window.localStorage.setItem(NICKNAME_KEY, value);
  } catch {
    // 保存できなくても、使える
  }
}

/** 登録できる、ゴールした記録 (1 回のプレイにつき 1 つ。id が変わると、新しいプレイ)。 */
export type FinishedRun = {
  id: number;
  mode: Mode;
  difficulty: Difficulty;
  /** 通常は点数、タイムアタックは 0.1 秒の数 */
  value: number;
};

export function MiniGameRanking({
  api,
  mode,
  difficulty,
  run,
}: {
  api: RankingApi;
  /** 表に出すランキング (いま選んでいるモードと難易度) */
  mode: Mode;
  difficulty: Difficulty;
  /** ゴールした直後の記録 (なければ null) */
  run: FinishedRun | null;
}) {
  // 読み込んだランキング。どの条件で読んだか (key) も持つ: 条件が変わったら、読み込み中になる
  const [loaded, setLoaded] = useState<{
    key: string;
    board: RankingBoard | null;
  } | null>(null);
  const remembered = useSyncExternalStore(noSubscribe, readNickname, () => "");
  const [edited, setEdited] = useState<string | null>(null);
  const nickname = edited ?? remembered;
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(
    null,
  );
  const [reload, setReload] = useState(0);

  // 選んだモード・難易度のランキングを読む (切り替えたとき、登録したあとに、読み直す)
  const wanted = `${mode}.${difficulty}.${reload}`;
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

  const submit = useCallback(async () => {
    if (run === null || sending) return;
    setSending(true);
    const result = await api.submit({
      mode: run.mode,
      difficulty: run.difficulty,
      value: run.value,
      nickname,
    });
    setSending(false);
    if (result.kind === "saved") {
      writeNickname(nickname.trim());
      setNotice({ id: run.id, text: `登録しました。${result.rank} 位です。` });
      setReload((count) => count + 1);
    } else if (result.kind === "not_best") {
      setNotice({
        id: run.id,
        text: `自分のベスト (${formatValue(run.mode, result.best)}) を超えていないので、登録しませんでした。`,
      });
    } else {
      // 登録できなかった: ニックネームを直して、もう一度できる
      setNotice({ id: -1, text: result.message });
    }
  }, [api, nickname, run, sending]);

  // このプレイは、登録が終わった (または、登録しなくてよいと分かった) か
  const done = run !== null && notice?.id === run.id;
  const offerForm = run !== null && !done && run.value >= 1;
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

      {run !== null && (
        <div className="mt-3 rounded-lg bg-[#f3f5ff] p-3">
          <p className="text-xs font-semibold">
            この記録: {MODE_NAMES[run.mode]}・
            {DIFFICULTIES[run.difficulty].name}{" "}
            {formatValue(run.mode, run.value)}
          </p>
          {offerForm ? (
            <form
              className="mt-2 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className="flex flex-col gap-1 text-xs">
                ニックネーム (1〜{NICKNAME_MAX} 文字)
                <input
                  value={nickname}
                  onChange={(event) => setEdited(event.target.value)}
                  maxLength={NICKNAME_MAX * 2}
                  autoComplete="off"
                  spellCheck={false}
                  className={`${fieldClass} sm:w-56`}
                />
              </label>
              <Button type="submit" variant="primary" disabled={sending}>
                ランキングに登録
              </Button>
            </form>
          ) : null}
          {notice !== null && (
            <p role="status" className="mt-2 text-xs">
              {notice.text}
            </p>
          )}
        </div>
      )}

      {state === "failed" && (
        <p className="mt-3 text-xs">
          ランキングを読み込めませんでした。
          <button
            type="button"
            onClick={() => setReload((count) => count + 1)}
            className="ml-2 underline"
          >
            もう一度読み込む
          </button>
        </p>
      )}
      {state === "loading" && shown === null && (
        <p className="mt-3 text-xs text-muted">読み込み中…</p>
      )}
      {shown !== null && (
        <>
          {shown.entries.length === 0 ? (
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
          )}
        </>
      )}
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
