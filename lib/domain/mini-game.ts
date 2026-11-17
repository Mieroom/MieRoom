// ミニゲーム「遅刻ダッシュ」(学生と時間割管理者だけの隠し要素)。サーバーも DB も使わない、画面の中だけの規則。
// 画面 (components/screens/mini-game.tsx) は、ここの関数を呼んで描くだけ。
//
// 遊び方: 家 (8:00) から走って、9:15 までに教室へ着く。現実の 1 秒が、ゲームの中の 1 分。
// 障害物にぶつかると転んで 2 秒 (= 2 分) 止まる。道のとちゅうで、ランダムに「できごと」(最大 3 つ)
// が起きる。9:15 までに着けなかったら遅刻。ベストは、何分余裕で着いたか。

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

// ---------------------------------------------------------------- 世界と時刻

export const WORLD = { width: 640, height: 240, groundY: 196 } as const;
export const PLAYER = { x: 72, width: 26, height: 38 } as const;

const GRAVITY = 1900; // px/s²
const JUMP_SPEED = 640; // px/s (上向き)
const RUN_SPEED = 280; // px/s
const BOOST_RATE = 1.3; // 飴をもらったあとの速さ
const HIT_MARGIN = 5; // 当たり判定を、見た目より少し小さくする (px)
/** 空中にいる時間 (秒): 障害物の間隔が、跳べる間隔より短くならないようにする。 */
const AIR_TIME = (2 * JUMP_SPEED) / GRAVITY;

/** 1 メートル = これだけ進んだ距離 (px)。 */
export const PX_PER_METER = 12;
/** 家から教室までの道のり (px)。まっすぐ走ると、約 56 秒。 */
export const ROUTE_LENGTH = 15680;

/** 8:00 に家を出る。9:15 までに教室へ着く (分。0:00 からの経過)。 */
export const START_MINUTE = 8 * 60;
export const DEADLINE_MINUTE = 9 * 60 + 15;

export type Stage = "home" | "street" | "school";
/** 場面の切れ目 (道のりの位置)。家のドアと、校門。 */
export const STAGE_STARTS: { stage: Stage; from: number }[] = [
  { stage: "home", from: 0 },
  { stage: "street", from: 1500 },
  { stage: "school", from: 11800 },
];

export function stageAt(distance: number): Stage {
  let current: Stage = "home";
  for (const item of STAGE_STARTS)
    if (distance >= item.from) current = item.stage;
  return current;
}

/** 分 (0:00 からの経過) を「8:05」の形にする。 */
export function clockText(minutes: number): string {
  const whole = Math.floor(minutes);
  const hour = Math.floor(whole / 60);
  const minute = whole % 60;
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- できごと

/** 転んだときに止まる時間 (秒)。 */
export const STUN_SECONDS = 2;
export const MOTHER_TAPS = 10; // お母さん: これだけ連打すると、解放される
export const MOTHER_MAX = 7; // 連打しなくても、この秒数で終わる
export const OBASAN_TAPS = 8; // おばさんを起こす連打
export const OBASAN_MAX = 6;
export const BOOST_SECONDS = 8; // 助けたお礼の飴で、速くなる時間
export const CROSSING_WAIT = 5.5; // 踏切で待つ秒数
export const DASH_OPEN = 1; // 渡れる合図が出るまで (秒)
export const DASH_CLOSE = 1.7; // 合図が消えるまで (秒)
export const BLOCKED_SECONDS = 4; // 渡るのに失敗して、電車に阻まれる秒数
/** 助ける / 渡る の前に、止まる位置 (できごとの手前、px)。 */
const APPROACH = 150;

export type GameEvent =
  | {
      kind: "mother";
      at: number;
      phase: "idle" | "scold" | "done";
      taps: number;
      elapsed: number;
    }
  | {
      kind: "obasan";
      at: number;
      phase: "idle" | "ask" | "help" | "done";
      taps: number;
      elapsed: number;
      helped: boolean;
    }
  | {
      kind: "crossing";
      at: number;
      phase: "idle" | "ask" | "wait" | "dash" | "blocked" | "done";
      elapsed: number;
    };

export type Obstacle = {
  /** 道のりの位置 (左端) */
  at: number;
  width: number;
  height: number;
  /** もうぶつかった (一度だけ) */
  hit: boolean;
  /** おばさんの体 (見て見ぬふりをしたとき) */
  body?: boolean;
};

export type GameState = {
  status: "ready" | "playing" | "arrived" | "late";
  /** 進んだ道のり (px) */
  distance: number;
  /** 足元の高さ (0 = 地面) */
  y: number;
  vy: number;
  /** 走った時間 (秒)。時刻と、足の動きに使う */
  time: number;
  /** 転んで止まっている残り (秒) */
  stun: number;
  /** 速い状態の残り (秒) */
  boost: number;
  obstacles: Obstacle[];
  events: GameEvent[];
  /** 進行中のできごと (あるあいだは、走らない) */
  active: GameEvent | null;
  tags: {
    scolded: number;
    helped: boolean;
    ignored: boolean;
    waited: boolean;
    dashed: boolean;
    blocked: boolean;
    falls: number;
  };
};

function makeEvent(kind: GameEvent["kind"], at: number): GameEvent {
  if (kind === "mother")
    return { kind, at, phase: "idle", taps: 0, elapsed: 0 };
  if (kind === "obasan")
    return { kind, at, phase: "idle", taps: 0, elapsed: 0, helped: false };
  return { kind, at, phase: "idle", elapsed: 0 };
}

/** できごとが始まる位置 (道のり)。お母さんは、そこへ着いたとき。ほかは、手前で止まる。 */
function triggerAt(event: GameEvent): number {
  return event.kind === "mother" ? event.at : event.at - APPROACH;
}

/**
 * 新しいゲーム。できごと (最大 3 つ) と障害物は、ここで先に決める (rand は 0 以上 1 未満の数を返す関数)。
 * 障害物どうしの間隔は、速い状態でも、跳び越えて着地できる長さより、必ず長い。
 * できごとの前後には、障害物を置かない。家の中にも置かない。
 */
export function createGame(rand: () => number = Math.random): GameState {
  const events: GameEvent[] = [];
  if (rand() < 0.75) events.push(makeEvent("mother", 150 + rand() * 350));
  if (rand() < 0.75) events.push(makeEvent("obasan", 3200 + rand() * 3400));
  if (rand() < 0.7) events.push(makeEvent("crossing", 8000 + rand() * 2400));
  if (events.length === 0) {
    const kinds = ["mother", "obasan", "crossing"] as const;
    const kind = kinds[Math.min(2, Math.floor(rand() * 3))];
    const at =
      kind === "mother"
        ? 150 + rand() * 350
        : kind === "obasan"
          ? 3200 + rand() * 3400
          : 8000 + rand() * 2400;
    events.push(makeEvent(kind, at));
  }
  events.sort((a, b) => a.at - b.at);

  const minGap = RUN_SPEED * BOOST_RATE * (AIR_TIME + 0.18);
  const obstacles: Obstacle[] = [];
  let x = 1900;
  while (x < ROUTE_LENGTH - 700) {
    const width = 18 + Math.floor(rand() * 18);
    const height = 22 + Math.floor(rand() * 26);
    const blocking = events.find(
      (event) => x + width > event.at - 500 && x < event.at + 400,
    );
    if (blocking) {
      x = blocking.at + 400;
      continue;
    }
    obstacles.push({ at: x, width, height, hit: false });
    x += width + PLAYER.width + minGap + rand() * 320;
  }

  return {
    status: "ready",
    distance: 0,
    y: 0,
    vy: 0,
    time: 0,
    stun: 0,
    boost: 0,
    obstacles,
    events,
    active: null,
    tags: {
      scolded: 0,
      helped: false,
      ignored: false,
      waited: false,
      dashed: false,
      blocked: false,
      falls: 0,
    },
  };
}

/** いまの時刻 (分。0:00 からの経過)。 */
export function clockMinute(state: GameState): number {
  return START_MINUTE + state.time;
}

export function scoreOf(state: GameState): number {
  return Math.floor(state.distance / PX_PER_METER);
}

export function startGame(state: GameState): void {
  state.status = "playing";
}

export function jump(state: GameState): void {
  if (
    state.status === "playing" &&
    state.active === null &&
    state.stun <= 0 &&
    state.y === 0
  ) {
    state.vy = JUMP_SPEED;
  }
}

/** 押された (タップ / スペース): できごとの最中は、連打や合図。ふだんは、ジャンプ。 */
export function press(state: GameState): void {
  if (state.status !== "playing") return;
  const event = state.active;
  if (event === null) {
    jump(state);
    return;
  }
  if (event.kind === "mother" && event.phase === "scold") event.taps += 1;
  else if (event.kind === "obasan" && event.phase === "help") event.taps += 1;
  else if (event.kind === "crossing" && event.phase === "dash") {
    if (event.elapsed >= DASH_OPEN && event.elapsed <= DASH_CLOSE) {
      event.phase = "done";
      state.tags.dashed = true;
      state.active = null;
    } else {
      // 早すぎる: 電車に阻まれる
      event.phase = "blocked";
      event.elapsed = 0;
      state.tags.blocked = true;
    }
  }
}

/** 選ぶ: 0 = 左の選択肢 (助ける / 待つ)、1 = 右の選択肢 (通り過ぎる / 渡る)。 */
export function choose(state: GameState, option: 0 | 1): void {
  if (state.status !== "playing") return;
  const event = state.active;
  if (event === null) return;
  if (event.kind === "obasan" && event.phase === "ask") {
    if (option === 0) {
      event.phase = "help";
      event.taps = 0;
      event.elapsed = 0;
    } else {
      // 見て見ぬふり: おばさんの体が、道に残る (跳び越える)
      event.phase = "done";
      state.tags.ignored = true;
      state.obstacles.push({
        at: event.at,
        width: 36,
        height: 12,
        hit: false,
        body: true,
      });
      state.obstacles.sort((a, b) => a.at - b.at);
      state.active = null;
    }
  } else if (event.kind === "crossing" && event.phase === "ask") {
    event.elapsed = 0;
    if (option === 0) {
      event.phase = "wait";
      state.tags.waited = true;
    } else {
      event.phase = "dash";
    }
  }
}

/** いまの時刻と進み具合。画面の文字や選択肢の表示に使う。 */
export type EventView = {
  kind: GameEvent["kind"];
  phase: string;
  taps: number;
  need: number;
  /** 渡れる合図が出ているか */
  signal: boolean;
};

export function eventView(state: GameState): EventView | null {
  const event = state.active;
  if (event === null) return null;
  return {
    kind: event.kind,
    phase: event.phase,
    taps: "taps" in event ? event.taps : 0,
    need:
      event.kind === "mother"
        ? MOTHER_TAPS
        : event.kind === "obasan"
          ? OBASAN_TAPS
          : 0,
    signal:
      event.kind === "crossing" &&
      event.phase === "dash" &&
      event.elapsed >= DASH_OPEN &&
      event.elapsed <= DASH_CLOSE,
  };
}

function stepEvent(state: GameState, event: GameEvent, dt: number): void {
  if (event.kind === "mother" && event.phase === "scold") {
    event.elapsed += dt;
    if (event.taps >= MOTHER_TAPS || event.elapsed >= MOTHER_MAX) {
      event.phase = "done";
      state.tags.scolded = event.elapsed;
      state.active = null;
    }
  } else if (event.kind === "obasan" && event.phase === "help") {
    event.elapsed += dt;
    if (event.taps >= OBASAN_TAPS || event.elapsed >= OBASAN_MAX) {
      event.phase = "done";
      event.helped = true;
      state.tags.helped = true;
      if (event.taps >= OBASAN_TAPS) state.boost = BOOST_SECONDS;
      state.active = null;
    }
  } else if (event.kind === "crossing") {
    if (event.phase === "wait") {
      event.elapsed += dt;
      if (event.elapsed >= CROSSING_WAIT) {
        event.phase = "done";
        state.active = null;
      }
    } else if (event.phase === "dash") {
      event.elapsed += dt;
      if (event.elapsed > DASH_CLOSE) {
        // 合図を逃した: 電車に阻まれる
        event.phase = "blocked";
        event.elapsed = 0;
        state.tags.blocked = true;
      }
    } else if (event.phase === "blocked") {
      event.elapsed += dt;
      if (event.elapsed >= BLOCKED_SECONDS) {
        event.phase = "done";
        state.active = null;
      }
    }
  }
}

/** dt 秒だけ進める。時刻は、いつでも進む (できごとの最中も、転んでいる間も)。 */
export function stepGame(state: GameState, dt: number): void {
  if (state.status !== "playing") return;
  state.time += dt;

  // ジャンプ (空中にいる間の動き)
  if (state.y > 0 || state.vy > 0) {
    state.vy -= GRAVITY * dt;
    state.y += state.vy * dt;
    if (state.y <= 0) {
      state.y = 0;
      state.vy = 0;
    }
  }

  if (state.active !== null) {
    stepEvent(state, state.active, dt);
  } else if (state.stun > 0) {
    state.stun = Math.max(0, state.stun - dt);
  } else {
    const speed = RUN_SPEED * (state.boost > 0 ? BOOST_RATE : 1);
    if (state.boost > 0) state.boost = Math.max(0, state.boost - dt);
    state.distance = Math.min(ROUTE_LENGTH, state.distance + speed * dt);

    // できごとの始まり
    for (const event of state.events) {
      if (event.phase === "idle" && state.distance >= triggerAt(event)) {
        event.phase = event.kind === "mother" ? "scold" : "ask";
        state.active = event;
        break;
      }
    }

    // 障害物にぶつかる (一度だけ。転んで止まる)
    if (state.active === null) {
      const left = HIT_MARGIN;
      const right = PLAYER.width - HIT_MARGIN;
      for (const obstacle of state.obstacles) {
        if (obstacle.hit) continue;
        const dx = obstacle.at - state.distance;
        const overlapX =
          right > dx + HIT_MARGIN && left < dx + obstacle.width - HIT_MARGIN;
        if (overlapX && state.y < obstacle.height - HIT_MARGIN) {
          obstacle.hit = true;
          state.stun = STUN_SECONDS;
          state.tags.falls += 1;
          break;
        }
      }
    }
  }

  if (state.distance >= ROUTE_LENGTH) {
    state.status = "arrived";
  } else if (clockMinute(state) >= DEADLINE_MINUTE) {
    state.status = "late";
  }
}

/** 終わったあとの、結果の文。 */
export type Summary = {
  outcome: "arrived" | "late";
  /** 着いた時刻 (遅刻のときは、9:15) */
  arrival: string;
  /** 何分余裕で着いたか (遅刻は 0) */
  margin: number;
  /** 遅刻のとき: 教室まで、あと何 m だったか */
  remaining: number;
  notes: string[];
};

export function summarize(state: GameState): Summary {
  const arrived = state.status === "arrived";
  const clock = Math.min(DEADLINE_MINUTE, clockMinute(state));
  const notes: string[] = [];
  const { tags } = state;
  if (tags.scolded > 0)
    notes.push(`お母さんに ${Math.ceil(tags.scolded)} 秒 怒られた`);
  if (tags.helped) notes.push("おばさんを助けた(いい人)");
  if (tags.ignored) notes.push("おばさんを見て見ぬふり…");
  if (tags.waited) notes.push("踏切で待った");
  if (tags.dashed) notes.push("踏切を駆け抜けた!");
  if (tags.blocked) notes.push("踏切で電車に阻まれた");
  if (tags.falls > 0) notes.push(`転んだ ${tags.falls} 回`);
  return {
    outcome: arrived ? "arrived" : "late",
    arrival: clockText(clock),
    margin: arrived ? Math.max(0, Math.floor(DEADLINE_MINUTE - clock)) : 0,
    remaining: arrived
      ? 0
      : Math.ceil((ROUTE_LENGTH - state.distance) / PX_PER_METER),
    notes,
  };
}
