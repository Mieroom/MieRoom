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
export const RUN_SPEED = 280; // px/s
export const BOOST_RATE = 1.3; // 飴をもらったあとの速さ
const HIT_MARGIN = 5; // 当たり判定を、見た目より少し小さくする (px)
/** 空中にいる時間 (秒): 障害物の間隔が、跳べる間隔より短くならないようにする。 */
export const AIR_TIME = (2 * JUMP_SPEED) / GRAVITY;

// 速さの調整とスタミナ: → でダッシュ、← でゆっくり。スタミナが空になると、息切れして、とても遅くなる。
export const DASH_RATE = 1.6; // ダッシュの速さ (ふだんの何倍か)
export const SLOW_RATE = 0.6; // ゆっくりの速さ
export const EXHAUSTED_RATE = 0.4; // 息切れ中の速さ
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 20; // ダッシュ中に、1 秒に減る量
export const RECOVER = 10; // ふだん (止まっているときも) に、1 秒に戻る量
export const RECOVER_SLOW = 25; // ゆっくり歩いているとき
export const RECOVER_AT = 30; // 息切れは、これまで戻ると終わる

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
// 新しいできごと
export const DOG_SECONDS = 6; // 犬に追いかけられる長さ (秒)
export const DOG_RATE = 1.4; // 犬の速さ (ふだんの何倍か)
export const DOG_START_GAP = 170; // 犬との最初の距離 (px)
export const VENDING_SECONDS = 2; // 自販機で、ひと息つく秒数
export const FRIEND_SECONDS = 3; // 友達と立ち話をする秒数
export const FRIEND_STAMINA = 40; // おにぎりで戻るスタミナ
export const BIKE_WINDOW = 0.8; // 自転車が飛び出して、よけられる秒数
export const TEACHER_TAPS = 8; // 校門のあいさつの連打
export const TEACHER_MAX = 5;
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
    }
  | {
      kind: "dog";
      at: number;
      phase: "idle" | "chase" | "done";
      elapsed: number;
      /** 犬との距離 (px)。0 になると、追いつかれる */
      gap: number;
    }
  | {
      kind: "vending";
      at: number;
      phase: "idle" | "ask" | "drink" | "done";
      elapsed: number;
    }
  | {
      kind: "friend";
      at: number;
      phase: "idle" | "ask" | "talk" | "done";
      elapsed: number;
    }
  | {
      kind: "bike";
      at: number;
      phase: "idle" | "warn" | "done";
      elapsed: number;
    }
  | {
      kind: "teacher";
      at: number;
      phase: "idle" | "greet" | "done";
      taps: number;
      elapsed: number;
    };

export type EventKind = GameEvent["kind"];

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

export type Pace = "slow" | "normal" | "dash";

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
  /** 押している速さ: ← ゆっくり / ふつう / → ダッシュ */
  pace: Pace;
  /** スタミナ (0〜100)。ダッシュで減り、休むと戻る */
  stamina: number;
  /** 息切れ中 (スタミナが空になってから、戻りきるまで) */
  exhausted: boolean;
  obstacles: Obstacle[];
  events: GameEvent[];
  /** 進行中のできごと (あるあいだは、走らない) */
  active: GameEvent | null;
  /** 犬に追いかけられている間 (走りながら) */
  chase: Extract<GameEvent, { kind: "dog" }> | null;
  tags: {
    scolded: number;
    helped: boolean;
    ignored: boolean;
    waited: boolean;
    dashed: boolean;
    blocked: boolean;
    falls: number;
    exhausted: number;
    bitten: boolean;
    dogEscaped: boolean;
    drank: boolean;
    chatted: boolean;
    bikeDodged: boolean;
    bikeHit: boolean;
    greeted: boolean;
  };
};

function makeEvent(kind: EventKind, at: number): GameEvent {
  switch (kind) {
    case "mother":
      return { kind, at, phase: "idle", taps: 0, elapsed: 0 };
    case "teacher":
      return { kind, at, phase: "idle", taps: 0, elapsed: 0 };
    case "obasan":
      return { kind, at, phase: "idle", taps: 0, elapsed: 0, helped: false };
    case "dog":
      return { kind, at, phase: "idle", elapsed: 0, gap: DOG_START_GAP };
    default:
      return { kind, at, phase: "idle", elapsed: 0 };
  }
}

/** できごとが始まる位置 (道のり)。お母さんと犬は、そこへ着いたとき。ほかは、手前で止まる。 */
function triggerAt(event: GameEvent): number {
  return event.kind === "mother" || event.kind === "dog"
    ? event.at
    : event.at - APPROACH;
}

/** できごとが起きうる場所 (道のり) と、選ばれやすさ。 */
export const EVENT_SLOTS: Record<
  EventKind,
  { weight: number; from: number; to: number }
> = {
  mother: { weight: 1, from: 150, to: 500 },
  dog: { weight: 1, from: 2000, to: 7800 },
  obasan: { weight: 1, from: 3200, to: 6600 },
  vending: { weight: 0.8, from: 2300, to: 9800 },
  friend: { weight: 0.8, from: 2300, to: 10000 },
  bike: { weight: 1, from: 2300, to: 11000 },
  crossing: { weight: 1, from: 8000, to: 10400 },
  teacher: { weight: 0.6, from: 11500, to: 11600 },
};
export const EVENT_KINDS = Object.keys(EVENT_SLOTS) as EventKind[];
/** できごとどうしは、これだけ離す (px)。 */
const MIN_EVENT_GAP = 1200;
/** 前回・前々回に出たできごとが、選ばれにくくなる度合い。 */
const RECENT_PENALTY = [0.2, 0.5];

/**
 * この回のできごとを選ぶ (1〜3 つ)。recent は、直近の回のできごと (新しい順)。
 * 前回に出たものは出にくく (0.2 倍)、前々回のものは少し出にくく (0.5 倍) する。
 * kinds を渡すと、その種類をそのまま使う (テスト用)。
 */
function pickEvents(
  rand: () => number,
  recent: string[][],
  forced?: EventKind[],
): GameEvent[] {
  let kinds: EventKind[];
  if (forced) {
    kinds = forced;
  } else {
    const r = rand();
    const count = r < 0.15 ? 1 : r < 0.6 ? 2 : 3;
    const pool = EVENT_KINDS.map((kind) => {
      let weight = EVENT_SLOTS[kind].weight;
      RECENT_PENALTY.forEach((penalty, index) => {
        if (recent[index]?.includes(kind)) weight *= penalty;
      });
      return { kind, weight };
    });
    kinds = [];
    for (let n = 0; n < count && pool.length > 0; n++) {
      const total = pool.reduce((sum, item) => sum + item.weight, 0);
      let t = rand() * total;
      let index = pool.findIndex((item) => {
        t -= item.weight;
        return t < 0;
      });
      if (index < 0) index = pool.length - 1;
      kinds.push(pool[index].kind);
      pool.splice(index, 1);
    }
  }
  const events: GameEvent[] = [];
  for (const kind of kinds) {
    const slot = EVENT_SLOTS[kind];
    for (let attempt = 0; attempt < 12; attempt++) {
      const at = slot.from + rand() * (slot.to - slot.from);
      if (events.every((item) => Math.abs(item.at - at) >= MIN_EVENT_GAP)) {
        events.push(makeEvent(kind, at));
        break;
      }
    }
  }
  events.sort((a, b) => a.at - b.at);
  return events;
}

/**
 * 新しいゲーム。できごと (1〜3 つ) と障害物は、ここで先に決める (rand は 0 以上 1 未満の数を返す関数)。
 * 障害物どうしの間隔は、ダッシュと飴で、いちばん速いときでも、跳び越えて着地できる長さより、必ず長い。
 * できごとの前後には、障害物を置かない。家の中にも置かない。
 */
export function createGame(
  rand: () => number = Math.random,
  options: { recent?: string[][]; kinds?: EventKind[] } = {},
): GameState {
  const events = pickEvents(rand, options.recent ?? [], options.kinds);

  const minGap = RUN_SPEED * DASH_RATE * BOOST_RATE * (AIR_TIME + 0.12);
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
    pace: "normal",
    stamina: STAMINA_MAX,
    exhausted: false,
    obstacles,
    events,
    active: null,
    chase: null,
    tags: {
      scolded: 0,
      helped: false,
      ignored: false,
      waited: false,
      dashed: false,
      blocked: false,
      falls: 0,
      exhausted: 0,
      bitten: false,
      dogEscaped: false,
      drank: false,
      chatted: false,
      bikeDodged: false,
      bikeHit: false,
      greeted: false,
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

/** 押している速さを決める (画面のキー・ボタンから呼ぶ)。 */
export function setPace(state: GameState, pace: Pace): void {
  state.pace = pace;
}

/** いまの速さの倍率: 息切れが最優先。ダッシュは、スタミナがあるときだけ。 */
function paceRate(state: GameState): number {
  if (state.exhausted) return EXHAUSTED_RATE;
  if (state.pace === "dash") return DASH_RATE;
  if (state.pace === "slow") return SLOW_RATE;
  return 1;
}

function updateStamina(state: GameState, dt: number, dashing: boolean): void {
  if (dashing) {
    state.stamina -= STAMINA_DRAIN * dt;
    if (state.stamina <= 0) {
      state.stamina = 0;
      state.exhausted = true;
      state.tags.exhausted += 1;
    }
  } else {
    const rate = state.pace === "slow" ? RECOVER_SLOW : RECOVER;
    state.stamina = Math.min(STAMINA_MAX, state.stamina + rate * dt);
    if (state.exhausted && state.stamina >= RECOVER_AT) state.exhausted = false;
  }
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
  else if (event.kind === "teacher" && event.phase === "greet") event.taps += 1;
  else if (event.kind === "obasan" && event.phase === "help") event.taps += 1;
  else if (event.kind === "bike" && event.phase === "warn") {
    // 自転車をよけた
    event.phase = "done";
    state.tags.bikeDodged = true;
    state.active = null;
  } else if (event.kind === "crossing" && event.phase === "dash") {
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
  } else if (event.kind === "vending" && event.phase === "ask") {
    if (option === 0) {
      event.phase = "drink";
      event.elapsed = 0;
    } else {
      event.phase = "done";
      state.active = null;
    }
  } else if (event.kind === "friend" && event.phase === "ask") {
    if (option === 0) {
      event.phase = "talk";
      event.elapsed = 0;
    } else {
      event.phase = "done";
      state.active = null;
    }
  }
}

/** いまの時刻と進み具合。画面の文字や選択肢の表示に使う。 */
export type EventView = {
  kind: GameEvent["kind"];
  phase: string;
  taps: number;
  need: number;
  /** 渡れる合図 / よける合図が出ているか */
  signal: boolean;
  /** 犬との距離の残り (0〜1)。犬に追われているときだけ */
  progress: number;
};

export function eventView(state: GameState): EventView | null {
  const event = state.active;
  if (event === null) {
    const dog = state.chase;
    if (dog === null) return null;
    return {
      kind: "dog",
      phase: "chase",
      taps: 0,
      need: 0,
      signal: false,
      progress: Math.max(0, Math.min(1, dog.gap / DOG_START_GAP)),
    };
  }
  return {
    kind: event.kind,
    phase: event.phase,
    taps: "taps" in event ? event.taps : 0,
    need:
      event.kind === "mother"
        ? MOTHER_TAPS
        : event.kind === "obasan"
          ? OBASAN_TAPS
          : event.kind === "teacher"
            ? TEACHER_TAPS
            : 0,
    signal:
      (event.kind === "crossing" &&
        event.phase === "dash" &&
        event.elapsed >= DASH_OPEN &&
        event.elapsed <= DASH_CLOSE) ||
      (event.kind === "bike" && event.phase === "warn"),
    progress: 0,
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
      if (event.taps >= OBASAN_TAPS) {
        state.boost = BOOST_SECONDS;
        state.stamina = STAMINA_MAX;
        state.exhausted = false;
      }
      state.active = null;
    }
  } else if (event.kind === "teacher" && event.phase === "greet") {
    event.elapsed += dt;
    if (event.taps >= TEACHER_TAPS || event.elapsed >= TEACHER_MAX) {
      event.phase = "done";
      state.tags.greeted = true;
      state.active = null;
    }
  } else if (event.kind === "vending" && event.phase === "drink") {
    event.elapsed += dt;
    if (event.elapsed >= VENDING_SECONDS) {
      event.phase = "done";
      state.tags.drank = true;
      state.stamina = STAMINA_MAX;
      state.exhausted = false;
      state.active = null;
    }
  } else if (event.kind === "friend" && event.phase === "talk") {
    event.elapsed += dt;
    if (event.elapsed >= FRIEND_SECONDS) {
      event.phase = "done";
      state.tags.chatted = true;
      state.stamina = Math.min(STAMINA_MAX, state.stamina + FRIEND_STAMINA);
      if (state.exhausted && state.stamina >= RECOVER_AT) {
        state.exhausted = false;
      }
      state.active = null;
    }
  } else if (event.kind === "bike" && event.phase === "warn") {
    event.elapsed += dt;
    if (event.elapsed >= BIKE_WINDOW) {
      // よけられなかった: 転ぶ
      event.phase = "done";
      state.tags.bikeHit = true;
      state.stun = STUN_SECONDS;
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

/** 始まったときの段階 (お母さんと校門は連打、自転車は合図、ほかは選ぶ)。 */
const START_PHASE = {
  mother: "scold",
  teacher: "greet",
  bike: "warn",
  obasan: "ask",
  crossing: "ask",
  vending: "ask",
  friend: "ask",
} as const;

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

  // ダッシュできるのは、走っていて (できごとの最中でも転んでもいない)、息切れでないとき
  const dashing =
    state.active === null &&
    state.stun <= 0 &&
    !state.exhausted &&
    state.pace === "dash";
  updateStamina(state, dt, dashing);

  // この 1 コマで、走った速さ (px/s)。犬との距離に使う
  let moved = 0;
  if (state.active !== null) {
    stepEvent(state, state.active, dt);
  } else if (state.stun > 0) {
    state.stun = Math.max(0, state.stun - dt);
  } else {
    const speed =
      RUN_SPEED * paceRate(state) * (state.boost > 0 ? BOOST_RATE : 1);
    moved = speed;
    if (state.boost > 0) state.boost = Math.max(0, state.boost - dt);
    state.distance = Math.min(ROUTE_LENGTH, state.distance + speed * dt);

    // できごとの始まり
    for (const event of state.events) {
      if (event.phase !== "idle" || state.distance < triggerAt(event)) continue;
      if (event.kind === "dog") {
        // 犬は、走りながらの追いかけっこ (走りは止まらない)
        event.phase = "chase";
        event.elapsed = 0;
        event.gap = DOG_START_GAP;
        state.chase = event;
        continue;
      }
      event.phase = START_PHASE[event.kind];
      state.active = event;
      // ほかのできごとが始まったら、犬は、あきらめて去る
      if (state.chase !== null) {
        state.chase.phase = "done";
        state.chase = null;
      }
      break;
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

  // 犬: 走る速さが犬より遅いと、距離が縮む。0 で追いつかれて転ぶ。時間いっぱい逃げ切れば、成功
  const dog = state.chase;
  if (dog !== null) {
    dog.elapsed += dt;
    dog.gap += (moved - RUN_SPEED * DOG_RATE) * dt;
    if (dog.gap <= 0) {
      dog.phase = "done";
      state.chase = null;
      state.stun = STUN_SECONDS;
      state.tags.bitten = true;
    } else if (dog.elapsed >= DOG_SECONDS) {
      dog.phase = "done";
      state.chase = null;
      state.tags.dogEscaped = true;
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
  if (tags.dogEscaped) notes.push("犬から逃げ切った!");
  if (tags.bitten) notes.push("犬に追いつかれた…");
  if (tags.drank) notes.push("自販機でひと息ついた");
  if (tags.chatted) notes.push("友達からおにぎりをもらった");
  if (tags.bikeDodged) notes.push("自転車をよけた!");
  if (tags.bikeHit) notes.push("自転車にぶつかって転んだ");
  if (tags.greeted) notes.push("校門で先生にあいさつした");
  if (tags.falls > 0) notes.push(`転んだ ${tags.falls} 回`);
  if (tags.exhausted > 0) notes.push(`息切れした ${tags.exhausted} 回`);
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
