"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createGame,
  floorLabel,
  jump,
  MINI_GAME_NAME,
  PLAYER,
  scoreOf,
  startGame,
  stepGame,
  WORLD,
  type GameState,
} from "@/lib/domain/mini-game";

// 学生だけの隠し要素「遅刻ダッシュ」: 1限に間に合うよう、廊下を走って、障害物をよける。
// 画面の中だけで動く (サーバー・DB は使わない)。音は出さない。ベストは、この端末にだけ残す。

const BEST_KEY = "mieroom.miniGame.best";
// 終わった直後の連打で、すぐ始まり直さないための待ち時間 (ミリ秒)
const RESTART_LOCK_MS = 450;
// 重いタブやバックグラウンドから戻ったとき、一気に進まないための 1 コマの上限 (秒)
const MAX_FRAME = 1 / 30;

const COLOR = {
  sky: "#f1f3f8",
  wall: "#e4e8f2",
  floor: "#c9d0e3",
  ink: "#1f2a44",
  brand: "#4f5bd5",
  obstacle: "#a3101f",
  face: "#ffffff",
} as const;

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

function draw(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  score: number,
  best: number,
) {
  const { width, height, groundY } = WORLD;
  ctx.clearRect(0, 0, width, height);

  // 廊下: 壁と床
  ctx.fillStyle = COLOR.sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLOR.wall;
  ctx.fillRect(0, 40, width, groundY - 40);
  ctx.fillStyle = COLOR.floor;
  ctx.fillRect(0, groundY, width, height - groundY);
  // 床の目地: 進むと流れる
  ctx.fillStyle = COLOR.ink;
  ctx.globalAlpha = 0.12;
  const offset = game.distance % 80;
  for (let x = -offset; x < width; x += 80)
    ctx.fillRect(x, groundY + 10, 40, 3);
  ctx.globalAlpha = 1;

  // 障害物 (床に落ちたバッグ)
  ctx.fillStyle = COLOR.obstacle;
  for (const obstacle of game.obstacles) {
    ctx.beginPath();
    ctx.roundRect(
      obstacle.x,
      groundY - obstacle.height,
      obstacle.width,
      obstacle.height,
      5,
    );
    ctx.fill();
  }

  // ピンのキャラ
  const top = groundY - game.y - PLAYER.height;
  ctx.fillStyle = COLOR.brand;
  ctx.beginPath();
  ctx.roundRect(PLAYER.x, top, PLAYER.width, PLAYER.height - 8, 12);
  ctx.fill();
  ctx.fillStyle = COLOR.face;
  ctx.beginPath();
  ctx.arc(PLAYER.x + PLAYER.width / 2, top + 13, 5, 0, Math.PI * 2);
  ctx.fill();
  // 足: 走っている間は交互に動く
  const step = game.y > 0 ? 0 : Math.sin(game.time * 22) * 4;
  ctx.fillStyle = COLOR.ink;
  ctx.fillRect(PLAYER.x + 4, groundY - game.y - 8, 6, 8 + step / 2);
  ctx.fillRect(
    PLAYER.x + PLAYER.width - 10,
    groundY - game.y - 8,
    6,
    8 - step / 2,
  );

  // 点数・階・ベスト
  ctx.fillStyle = COLOR.ink;
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${floorLabel(score)}  ${score} m`, 16, 28);
  ctx.textAlign = "right";
  ctx.font = "12px sans-serif";
  ctx.fillText(`ベスト ${best} m`, width - 16, 26);
  ctx.textAlign = "center";
  ctx.font = "bold 16px sans-serif";
  if (game.status === "ready") {
    ctx.fillText("タップ / スペースで、スタート", width / 2, 96);
  } else if (game.status === "over") {
    ctx.fillText(`遅刻!  ${score} m`, width / 2, 90);
    ctx.font = "13px sans-serif";
    ctx.fillText("もう一度: タップ / スペース", width / 2, 114);
  }
}

export function MiniGame() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameState>(createGame());
  const best = useRef(0);
  const overAt = useRef(0);
  const [result, setResult] = useState("");

  // 押された: 始める / 跳ぶ / 終わったあとは、やり直す
  const press = useCallback(() => {
    const state = game.current;
    if (state.status === "ready") {
      startGame(state);
    } else if (state.status === "playing") {
      jump(state);
    } else if (performance.now() - overAt.current > RESTART_LOCK_MS) {
      game.current = createGame();
      startGame(game.current);
      setResult("");
    }
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    best.current = readBest();

    // 画面の細かさに合わせて、くっきり描く
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = WORLD.width * ratio;
    element.height = WORLD.height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

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
        setResult(
          `遅刻! ${floorLabel(score)}で ${score} m。${isBest ? "ベスト更新!" : ""}`,
        );
      }
      draw(ctx, state, score, best.current);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // 別のタブに移ったら止め、戻ったとき最初から (走りっぱなしで落ちないように)
    const onHidden = () => {
      if (document.hidden && game.current.status === "playing") {
        game.current = createGame();
      }
    };
    document.addEventListener("visibilitychange", onHidden);

    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        if (!event.repeat) press();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("keydown", onKey);
    };
  }, [press]);

  return (
    <div className="flex flex-col gap-3">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`${MINI_GAME_NAME}: タップかスペースキーで、障害物をよけて走る`}
        onPointerDown={(event) => {
          event.preventDefault();
          press();
        }}
        className="aspect-[8/3] w-full touch-none select-none rounded-[11px] border border-line bg-white"
      />
      <p role="status" className="min-h-5 text-xs text-muted">
        {result}
      </p>
    </div>
  );
}
