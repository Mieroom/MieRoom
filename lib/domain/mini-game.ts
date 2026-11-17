// ミニゲーム「遅刻ダッシュ」(学生と時間割管理者だけの隠し要素)。サーバーも DB も使わない、画面の中だけの規則。
// 画面 (components/screens/mini-game.tsx) は、ここの関数を呼んで描くだけ。

/** 画面に出す名前。変えるときは、ここだけを直す。 */
export const MINI_GAME_NAME = "ミニゲーム";

/** 入り口の合言葉: 先生一覧の「名前で絞る」に入れると、学生と時間割管理者だけがゲームへ移る。 */
const PHRASES = ["遅刻ダッシュ", "ちこくだっしゅ"];

function normalizePhrase(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function isMiniGamePhrase(value: string | null | undefined): boolean {
  if (typeof value !== "string" || value === "") return false;
  const given = normalizePhrase(value);
  return PHRASES.some((phrase) => normalizePhrase(phrase) === given);
}

/** ゲームを遊べるのは、学生と時間割管理者だけ (先生は、入り口も、ページも使えない)。 */
export function canPlayMiniGame(role: string): boolean {
  return role === "student" || role === "admin";
}

/** 先生一覧の「名前で絞る」で、ゲームへ移すか: 遊べる人が、合言葉を入れたときだけ。 */
export function opensMiniGame(
  role: string,
  query: string | undefined,
): boolean {
  return canPlayMiniGame(role) && isMiniGamePhrase(query);
}

// ---------------------------------------------------------------- ゲームの世界 (論理サイズ)

export const WORLD = { width: 640, height: 240, groundY: 196 } as const;
export const PLAYER = { x: 72, width: 26, height: 38 } as const;

const GRAVITY = 1900; // px/s²
const JUMP_SPEED = 640; // px/s (上向き)
const START_SPEED = 250; // px/s
const MAX_SPEED = 560;
/** 1 メートル = これだけ進んだ距離 (px)。 */
const PX_PER_METER = 12;
/** この距離 (m) ごとに、1 階上がる。6 階の次は屋上。 */
export const METERS_PER_FLOOR = 100;
const HIT_MARGIN = 5; // 当たり判定を、見た目より少し小さくする (px)

export type Obstacle = { x: number; width: number; height: number };

export type GameState = {
  status: "ready" | "playing" | "over";
  /** 進んだ距離 (px) */
  distance: number;
  /** 足元の高さ (0 = 地面) */
  y: number;
  vy: number;
  obstacles: Obstacle[];
  /** 次の障害物までに、進む距離 (px) */
  untilNext: number;
  /** 走った時間 (秒)。足の動きに使う */
  time: number;
};

export function createGame(): GameState {
  return {
    status: "ready",
    distance: 0,
    y: 0,
    vy: 0,
    obstacles: [],
    untilNext: 420,
    time: 0,
  };
}

export function scoreOf(state: GameState): number {
  return Math.floor(state.distance / PX_PER_METER);
}

/** いまの階の番号: 1〜6、そのあとは 7 (屋上)。 */
export function floorNumber(score: number): number {
  return Math.min(7, 1 + Math.floor(score / METERS_PER_FLOOR));
}

/** いまの階の名前: 1階〜6階、そのあとは屋上。 */
export function floorLabel(score: number): string {
  const floor = floorNumber(score);
  return floor >= 7 ? "屋上" : `${floor}階`;
}

export function speedAt(score: number): number {
  return Math.min(MAX_SPEED, START_SPEED + score * 1.6);
}

export function startGame(state: GameState): void {
  state.status = "playing";
}

export function jump(state: GameState): void {
  if (state.status === "playing" && state.y === 0) state.vy = JUMP_SPEED;
}

/** 空中にいる時間 (秒): 障害物の間隔が、跳べる間隔より短くならないようにする。 */
const AIR_TIME = (2 * JUMP_SPEED) / GRAVITY;

/**
 * dt 秒だけ進める。rand は 0 以上 1 未満の数を返す関数 (テストでは固定の値にできる)。
 * 障害物の間隔は、いまの速さで跳び越えて着地できる長さより、必ず長い。
 */
export function stepGame(
  state: GameState,
  dt: number,
  rand: () => number,
): void {
  if (state.status !== "playing") return;
  const speed = speedAt(scoreOf(state));
  const move = speed * dt;
  state.time += dt;
  state.distance += move;

  // 跳ぶ
  if (state.y > 0 || state.vy > 0) {
    state.vy -= GRAVITY * dt;
    state.y += state.vy * dt;
    if (state.y <= 0) {
      state.y = 0;
      state.vy = 0;
    }
  }

  // 障害物を動かして、画面の外に出たものを捨てる
  for (const obstacle of state.obstacles) obstacle.x -= move;
  state.obstacles = state.obstacles.filter(
    (obstacle) => obstacle.x + obstacle.width > -10,
  );

  // 新しい障害物
  state.untilNext -= move;
  if (state.untilNext <= 0) {
    const width = 18 + Math.floor(rand() * 18);
    const height = 22 + Math.floor(rand() * 26);
    state.obstacles.push({ x: WORLD.width + 10, width, height });
    const minGap = speed * (AIR_TIME + 0.18) + width + PLAYER.width;
    state.untilNext = minGap + rand() * speed * 0.55;
  }

  // 当たり
  const left = PLAYER.x + HIT_MARGIN;
  const right = PLAYER.x + PLAYER.width - HIT_MARGIN;
  const feet = state.y;
  for (const obstacle of state.obstacles) {
    const overlapX =
      right > obstacle.x + HIT_MARGIN &&
      left < obstacle.x + obstacle.width - HIT_MARGIN;
    if (overlapX && feet < obstacle.height - HIT_MARGIN) {
      state.status = "over";
      return;
    }
  }
}
