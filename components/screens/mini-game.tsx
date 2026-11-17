"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createGame,
  floorLabel,
  jump,
  MINI_GAME_NAME,
  scoreOf,
  startGame,
  stepGame,
  type GameState,
} from "@/lib/domain/mini-game";
import { ART, CHARACTERS, drawScene } from "./mini-game-art";

// 学生と時間割管理者だけの隠し要素「遅刻ダッシュ」(ドット絵): 1限に間に合うよう、廊下を走って、
// 障害物をよける。画面の中だけで動く (サーバー・DB は使わない)。音は出さない。
// ベストは、この端末にだけ残す。

const BEST_KEY = "mieroom.miniGame.best";
const CHARACTER_KEY = "mieroom.miniGame.character";
// 終わった直後の連打で、すぐ始まり直さないための待ち時間 (ミリ秒)
const RESTART_LOCK_MS = 450;
// 重いタブやバックグラウンドから戻ったとき、一気に進まないための 1 コマの上限 (秒)
const MAX_FRAME = 1 / 30;

type Phase = "ready" | "playing" | "over";

function readBest(): number {
  try {
    const value = Number(window.localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function writeBest(score: number) {
  try {
    window.localStorage.setItem(BEST_KEY, String(score));
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

export function MiniGame() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameState>(createGame());
  const best = useRef(0);
  const overAt = useRef(0);
  const characterIndex = useRef(0);
  const [character, setCharacter] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<{
    score: number;
    floor: string;
    isBest: boolean;
  } | null>(null);

  // 押された: 始める / 跳ぶ / 終わったあとは、やり直す
  const press = useCallback(() => {
    const state = game.current;
    if (state.status === "ready") {
      startGame(state);
      setPhase("playing");
    } else if (state.status === "playing") {
      jump(state);
    } else if (performance.now() - overAt.current > RESTART_LOCK_MS) {
      game.current = createGame();
      startGame(game.current);
      setResult(null);
      setPhase("playing");
    }
  }, []);

  // キャラを替える (始める前と、終わったあと)。選んだキャラは、この端末に覚えておく
  const choose = useCallback((step: number) => {
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
    best.current = readBest();
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
      stepGame(state, dt, Math.random);
      const score = scoreOf(state);
      if (before === "playing" && state.status === "over") {
        overAt.current = now;
        const isBest = score > best.current;
        if (isBest) {
          best.current = score;
          writeBest(score);
        }
        setResult({ score, floor: floorLabel(score), isBest });
        setPhase("over");
      }
      drawScene(
        ctx,
        state,
        score,
        best.current,
        CHARACTERS[characterIndex.current],
      );
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // 別のタブに移ったら、最初からにする (走りっぱなしで落ちないように)
    const onHidden = () => {
      if (document.hidden && game.current.status === "playing") {
        game.current = createGame();
        setPhase("ready");
      }
    };
    document.addEventListener("visibilitychange", onHidden);

    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        if (!event.repeat) press();
      } else if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        choose(event.code === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("keydown", onKey);
    };
  }, [press, choose]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto w-full max-w-[960px]">
        {/* 小さな絵を、そのまま (なめらかにせず) 引き伸ばす: ドット絵 */}
        <canvas
          ref={canvas}
          width={ART.width}
          height={ART.height}
          role="img"
          aria-label={`${MINI_GAME_NAME}: タップかスペースキーで、障害物をよけて走る`}
          onPointerDown={(event) => {
            event.preventDefault();
            press();
          }}
          className="aspect-[8/3] w-full touch-none select-none rounded-[11px] border border-line bg-white [image-rendering:pixelated]"
        />
        {phase !== "playing" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-1 rounded-lg bg-[#1f2a44]/80 px-5 py-3 text-center text-white">
              {phase === "ready" ? (
                <>
                  <p className="text-base font-bold tracking-widest">
                    1限に遅刻するな!
                  </p>
                  <p className="text-xs">
                    タップ / スペースで スタート(← → でキャラを選ぶ)
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-bold tracking-widest">遅刻!</p>
                  <p className="text-sm">
                    {result?.floor}で {result?.score} m
                    {result?.isBest ? "  ベスト更新!" : ""}
                  </p>
                  <p className="text-xs">もう一度: タップ / スペース</p>
                </>
              )}
              <div className="pointer-events-auto mt-1 flex items-center gap-3 text-sm">
                <button
                  type="button"
                  aria-label="前のキャラ"
                  onClick={() => choose(-1)}
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
                  onClick={() => choose(1)}
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
        {phase === "over" && result
          ? `遅刻! ${result.floor}で ${result.score} m。${result.isBest ? "ベスト更新!" : ""}`
          : ""}
      </p>
    </div>
  );
}
