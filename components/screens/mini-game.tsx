"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  choose,
  clockText,
  createGame,
  DEADLINE_MINUTE,
  eventView,
  MINI_GAME_NAME,
  press as pressInGame,
  START_MINUTE,
  startGame,
  stepGame,
  summarize,
  type EventView,
  type GameState,
  type Summary,
} from "@/lib/domain/mini-game";
import { ART, CHARACTERS, drawScene } from "./mini-game-art";

// 学生と時間割管理者だけの隠し要素「遅刻ダッシュ」(ドット絵): 家 (8:00) から走って、9:15 までに
// 教室へ着く。道のとちゅうで、お母さん・倒れているおばさん・踏切のできごとが、ランダムに起きる。
// 画面の中だけで動く (サーバー・DB は使わない)。音は出さない。ベストとキャラは、この端末にだけ残す。

const BEST_KEY = "mieroom.miniGame.bestMargin";
const CHARACTER_KEY = "mieroom.miniGame.character";
// 終わった直後の連打で、すぐ始まり直さないための待ち時間 (ミリ秒)
const RESTART_LOCK_MS = 450;
// 重いタブやバックグラウンドから戻ったとき、一気に進まないための 1 コマの上限 (秒)
const MAX_FRAME = 1 / 30;

type Phase = "ready" | "playing" | "arrived" | "late";

function readBest(): number {
  try {
    const value = Number(window.localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function writeBest(margin: number) {
  try {
    window.localStorage.setItem(BEST_KEY, String(margin));
  } catch {
    // 保存できなくても、遊べる
  }
}

function readCharacter(): number {
  try {
    const id = window.localStorage.getItem(CHARACTER_KEY);
    const index = CHARACTERS.findIndex((item) => item.id === id);
    return index >= 0 ? index : 0;
  } catch {
    return 0;
  }
}

function writeCharacter(id: string) {
  try {
    window.localStorage.setItem(CHARACTER_KEY, id);
  } catch {
    // 保存できなくても、遊べる
  }
}

/** できごとの最中に、画面へ出す文。 */
function eventText(view: EventView): { title: string; hint: string } {
  if (view.kind === "mother") {
    return { title: "早く起きなさい!!", hint: "連打で言い訳しよう!" };
  }
  if (view.kind === "obasan") {
    return view.phase === "ask"
      ? { title: "おばさんが倒れている!", hint: "どうする?" }
      : { title: "大丈夫ですか!?", hint: "連打で起こそう!" };
  }
  if (view.phase === "ask") {
    return { title: "踏切が閉まった!", hint: "どうする?" };
  }
  if (view.phase === "wait") {
    return { title: "電車が通過中…", hint: "開くまで待つ" };
  }
  if (view.phase === "blocked") {
    return { title: "電車に阻まれた…", hint: "動けない" };
  }
  return view.signal
    ? { title: "いまだ!!", hint: "タップ / スペース!" }
    : { title: "電車が遠い…", hint: "合図を待て(早すぎると危ない)" };
}

const CHOICES: Record<string, [string, string]> = {
  obasan: ["助ける", "通り過ぎる"],
  crossing: ["待つ", "渡る"],
};

export function MiniGame() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameState>(createGame());
  const best = useRef(0);
  const overAt = useRef(0);
  const characterIndex = useRef(0);
  const viewKey = useRef("null");
  const [character, setCharacter] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [view, setView] = useState<EventView | null>(null);
  const [bestMargin, setBestMargin] = useState(0);
  const [result, setResult] = useState<(Summary & { isBest: boolean }) | null>(
    null,
  );

  // 押された: 始める / ジャンプ・連打・合図 / 終わったあとは、やり直す
  const press = useCallback(() => {
    const state = game.current;
    if (state.status === "ready") {
      startGame(state);
      setPhase("playing");
    } else if (state.status === "playing") {
      pressInGame(state);
    } else if (performance.now() - overAt.current > RESTART_LOCK_MS) {
      game.current = createGame();
      startGame(game.current);
      setResult(null);
      setView(null);
      viewKey.current = "null";
      setPhase("playing");
    }
  }, []);

  // 選ぶ (助ける / 通り過ぎる、待つ / 渡る)
  const pick = useCallback((option: 0 | 1) => {
    choose(game.current, option);
  }, []);

  // キャラを替える (始める前と、終わったあと)。選んだキャラは、この端末に覚えておく
  const changeCharacter = useCallback((step: number) => {
    if (game.current.status === "playing") return;
    const count = CHARACTERS.length;
    const next = (characterIndex.current + step + count) % count;
    characterIndex.current = next;
    setCharacter(next);
    writeCharacter(CHARACTERS[next].id);
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const savedBest = readBest();
    best.current = savedBest;
    setBestMargin(savedBest);
    const saved = readCharacter();
    characterIndex.current = saved;
    setCharacter(saved);

    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const state = game.current;
      const dt = Math.min((now - last) / 1000, MAX_FRAME);
      last = now;
      const before = state.status;
      stepGame(state, dt);
      if (
        before === "playing" &&
        (state.status === "arrived" || state.status === "late")
      ) {
        overAt.current = now;
        const summary = summarize(state);
        const isBest =
          summary.outcome === "arrived" && summary.margin > best.current;
        if (isBest) {
          best.current = summary.margin;
          writeBest(summary.margin);
          setBestMargin(summary.margin);
        }
        setResult({ ...summary, isBest });
        setPhase(state.status);
      }
      // できごとの表示は、変わったときだけ更新する
      const next = eventView(state);
      const key = JSON.stringify(next);
      if (key !== viewKey.current) {
        viewKey.current = key;
        setView(next);
      }
      drawScene(ctx, state, CHARACTERS[characterIndex.current]);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // 別のタブに移ったら、最初からにする (走りっぱなしで時間が過ぎないように)
    const onHidden = () => {
      if (document.hidden && game.current.status === "playing") {
        game.current = createGame();
        setPhase("ready");
        setView(null);
        viewKey.current = "null";
      }
    };
    document.addEventListener("visibilitychange", onHidden);

    const onKey = (event: KeyboardEvent) => {
      const state = game.current;
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        if (!event.repeat) press();
      } else if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        if (state.status === "playing") {
          choose(state, event.code === "ArrowLeft" ? 0 : 1);
        } else {
          changeCharacter(event.code === "ArrowLeft" ? -1 : 1);
        }
      } else if (event.code === "Digit1" || event.code === "Digit2") {
        if (state.status === "playing") {
          choose(state, event.code === "Digit1" ? 0 : 1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("keydown", onKey);
    };
  }, [press, changeCharacter]);

  const over = phase === "arrived" || phase === "late";
  const message = view ? eventText(view) : null;
  const choices = view && view.phase === "ask" ? CHOICES[view.kind] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto w-full max-w-[960px]">
        {/* 小さな絵を、そのまま (なめらかにせず) 引き伸ばす: ドット絵 */}
        <canvas
          ref={canvas}
          width={ART.width}
          height={ART.height}
          role="img"
          aria-label={`${MINI_GAME_NAME}: 家から教室まで、9:15 までに走る。タップかスペースキーでジャンプ`}
          onPointerDown={(event) => {
            event.preventDefault();
            press();
          }}
          className="aspect-[8/3] w-full touch-none select-none rounded-[11px] border border-line bg-white [image-rendering:pixelated]"
        />

        {/* できごと: 文と、連打の進み、選択肢 */}
        {phase === "playing" && view && message && (
          <div className="pointer-events-none absolute inset-x-0 top-[17%] flex justify-center">
            <div className="flex min-w-[15rem] flex-col items-center gap-1 rounded-lg bg-[#1f2a44]/85 px-5 py-3 text-center text-white">
              <p
                className={`text-lg font-bold tracking-widest ${
                  view.signal ? "text-[#ffe066]" : ""
                }`}
              >
                {message.title}
              </p>
              <p className="text-xs">{message.hint}</p>
              {view.need > 0 && view.phase !== "ask" && (
                <div className="mt-1 flex gap-1" aria-hidden="true">
                  {Array.from({ length: view.need }, (_, index) => (
                    <span
                      key={index}
                      className={`h-2.5 w-4 rounded-sm ${
                        index < view.taps ? "bg-[#ffe066]" : "bg-white/25"
                      }`}
                    />
                  ))}
                </div>
              )}
              {choices && (
                <div className="pointer-events-auto mt-2 flex gap-3">
                  {choices.map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => pick(index === 0 ? 0 : 1)}
                      className="rounded-md bg-white px-4 py-1.5 text-sm font-bold text-[#1f2a44] hover:bg-[#ffe066]"
                    >
                      {label}
                      <span className="ml-1 text-[10px] font-normal opacity-60">
                        {index === 0 ? "←" : "→"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 始める前と、終わったあと */}
        {phase !== "playing" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex max-w-[92%] flex-col items-center gap-1 rounded-lg bg-[#1f2a44]/85 px-5 py-3 text-center text-white">
              {phase === "ready" && (
                <>
                  <p className="text-base font-bold tracking-widest">
                    {clockText(START_MINUTE)} 起床! {clockText(DEADLINE_MINUTE)}{" "}
                    までに教室へ!
                  </p>
                  <p className="text-xs">
                    タップ / スペースで スタート(ジャンプも同じ)
                  </p>
                  {bestMargin > 0 && (
                    <p className="text-xs opacity-80">
                      ベスト: {bestMargin} 分の余裕
                    </p>
                  )}
                </>
              )}
              {over && result && (
                <>
                  <p className="text-lg font-bold tracking-widest">
                    {result.outcome === "arrived" ? "ゴール!" : "遅刻!"}
                  </p>
                  <p className="text-sm">
                    {result.outcome === "arrived"
                      ? `${result.arrival} 着 (余裕 ${result.margin} 分)${
                          result.isBest ? "  ベスト更新!" : ""
                        }`
                      : `${result.arrival} に間に合わなかった (あと ${result.remaining} m)`}
                  </p>
                  {result.notes.length > 0 && (
                    <ul className="text-[11px] opacity-85">
                      {result.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs">もう一度: タップ / スペース</p>
                </>
              )}
              <div className="pointer-events-auto mt-1 flex items-center gap-3 text-sm">
                <button
                  type="button"
                  aria-label="前のキャラ"
                  onClick={() => changeCharacter(-1)}
                  className="grid h-8 w-8 place-items-center rounded-md bg-white/15 font-bold hover:bg-white/30"
                >
                  ◀
                </button>
                <span className="min-w-[6.5em] text-center" aria-live="polite">
                  {CHARACTERS[character].name}
                  <span className="ml-1 text-[11px] opacity-70">
                    {character + 1}/{CHARACTERS.length}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="次のキャラ"
                  onClick={() => changeCharacter(1)}
                  className="grid h-8 w-8 place-items-center rounded-md bg-white/15 font-bold hover:bg-white/30"
                >
                  ▶
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p role="status" className="sr-only">
        {over && result
          ? result.outcome === "arrived"
            ? `ゴール! ${result.arrival} 着。余裕 ${result.margin} 分。`
            : `遅刻! ${result.arrival} に間に合わなかった。`
          : ""}
      </p>
    </div>
  );
}
