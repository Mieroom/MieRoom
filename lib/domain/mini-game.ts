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

// ---------------------------------------------------------------- 難易度

export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTY_IDS: Difficulty[] = ["easy", "normal", "hard"];

/** 難易度ごとの決まり。ふつうが、これまでと同じ。 */
export const DIFFICULTIES: Record<
  Difficulty,
  {
    name: string;
    /** 起床バーの、色のマスの数 (残りは、赤 = 二度寝。全部で 16) */
    wakeCells: Record<
      "perfect" | "good" | "normal" | "late" | "barely",
      number
    >;
    /** 起床バーの往復の速さ (1 秒に、バーの長さの何倍か) */
    wakeSpeed: { min: number; range: number };
    /** できごとの数 (最小・最大) */
    eventCount: [number, number];
    /** 寝坊 (8:15 以降) の日の、できごとの上限 */
    lateEventCap: number;
    /** ダッシュで減る、スタミナの割合 */
    drain: number;
    /** 道のりの長さの割合 (場面の切れ目とできごとの場所も、これに合わせる) */
    routeScale: number;
    /** 校舎の階段 (上る段の階の数。0 = 階段なし) */
    flights: number;
  }
> = {
  easy: {
    name: "かんたん",
    wakeCells: { perfect: 2, good: 3, normal: 2, late: 2, barely: 2 },
    wakeSpeed: { min: 0.55, range: 0.2 },
    eventCount: [1, 2],
    lateEventCap: 2,
    drain: 0.7,
    routeScale: 0.9,
    flights: 0,
  },
  normal: {
    name: "ふつう",
    wakeCells: { perfect: 1, good: 2, normal: 2, late: 2, barely: 2 },
    wakeSpeed: { min: 0.7, range: 0.3 },
    eventCount: [1, 3],
    lateEventCap: 2,
    drain: 1,
    routeScale: 1,
    flights: 0,
  },
  hard: {
    name: "むずかしい",
    wakeCells: { perfect: 1, good: 1, normal: 2, late: 1, barely: 2 },
    wakeSpeed: { min: 0.9, range: 0.4 },
    eventCount: [3, 4],
    lateEventCap: 3,
    drain: 1.3,
    routeScale: 0.75,
    flights: 5,
  },
};

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && value in DIFFICULTIES;
}

// ---------------------------------------------------------------- モード

/**
 * 通常: 起床チャレンジから始めて、9:15 までに着く。余裕と、いい行いで、点数がつく。
 * タイムアタック: 8:00 に家を出て、教室までの時間を競う (起床チャレンジと、9:15 の締めはない)。
 * コースは、その日の日付 (日本時間) で決まる。みんなが同じコースで、公平に比べられる。
 */
export type Mode = "normal" | "timeattack";
export const MODE_IDS: Mode[] = ["normal", "timeattack"];
export const MODE_NAMES: Record<Mode, string> = {
  normal: "通常",
  timeattack: "タイムアタック",
};

export function isMode(value: unknown): value is Mode {
  return value === "normal" || value === "timeattack";
}

/** 日本時間の日付 (2026-11-17 の形)。タイムアタックのコースは、この日付で決まる。 */
export function jstDayKey(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** その日・その難易度のコースの種 (同じ入力なら、どの端末でも同じ数)。 */
export function courseSeed(dayKey: string, difficulty: Difficulty): number {
  let hash = 0x811c9dc5; // FNV-1a
  for (const char of `${dayKey}|${difficulty}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 種から、0 以上 1 未満の数を順に返す関数 (mulberry32)。同じ種なら、同じ並び。 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1 メートル = これだけ進んだ距離 (px)。 */
export const PX_PER_METER = 12;
/** 家から教室までの道のり (px)。まっすぐ走ると、約 56 秒。 */
export const ROUTE_LENGTH = 15680;

/** 8:00 に家を出る。9:15 までに教室へ着く (分。0:00 からの経過)。 */
export const START_MINUTE = 8 * 60;
export const DEADLINE_MINUTE = 9 * 60 + 15;

/**
 * 起床チャレンジ: 目覚ましのバーを、タイミングよく止める。バーは 16 のマスに分かれていて、
 * 色の並びは、毎回ランダム (真ん中が良いとは限らない)。赤のマス (二度寝) で止めると、即遅刻。
 * いちばん良い (金) でも、起きられるのは 8:00。
 */
export const WAKE_ZONES = [
  { zone: "perfect", wake: 8 * 60, label: "ベストな目覚め!", cells: 1 },
  { zone: "good", wake: 8 * 60 + 5, label: "ちょっと遅め", cells: 2 },
  { zone: "normal", wake: 8 * 60 + 10, label: "寝坊気味…", cells: 2 },
  { zone: "late", wake: 8 * 60 + 15, label: "寝坊!", cells: 2 },
  { zone: "barely", wake: 8 * 60 + 20, label: "大寝坊…!", cells: 2 },
] as const;
/** バーのマスの数。ゾーンのマス以外は、赤 (二度寝)。 */
export const WAKE_CELLS = 16;
export type WakeZone = (typeof WAKE_ZONES)[number]["zone"] | "miss";
/** バーの区間 (0〜1)。同じゾーンが並ぶと、ひとつにまとまる。 */
export type WakeSegment = { from: number; to: number; zone: WakeZone };
/** 起きられる時刻の候補 (分)。 */
export const WAKE_OPTIONS: number[] = WAKE_ZONES.map((item) => item.wake);
/** 止めずに、この秒数がたつと、二度寝。 */
export const WAKE_TIME_LIMIT = 8;
/** 止めたあと、結果を見せる秒数。 */
export const WAKE_PAUSE = 1.2;
/** 目覚ましが鳴る時刻 (画面の表示用)。 */
export const WAKE_ALARM_MINUTE = 7 * 60 + 30;
/** この時刻以降に起きると、寝坊の日: 雨はくもりになり、できごとは 2 つまで。 */
const LATE_WAKE = 8 * 60 + 15;

/** バーの色の並び (毎回ランダム)。マスを並べ替えて、同じゾーンが続くところは、まとめる。 */
export function buildWakeSegments(
  rand: () => number,
  difficulty: Difficulty = "normal",
): WakeSegment[] {
  const cells: WakeZone[] = [];
  const counts = DIFFICULTIES[difficulty].wakeCells;
  for (const item of WAKE_ZONES) {
    for (let k = 0; k < counts[item.zone]; k++) cells.push(item.zone);
  }
  while (cells.length < WAKE_CELLS) cells.push("miss");
  for (let k = cells.length - 1; k > 0; k--) {
    const swap = Math.min(k, Math.floor(rand() * (k + 1)));
    [cells[k], cells[swap]] = [cells[swap], cells[k]];
  }
  const segments: WakeSegment[] = [];
  cells.forEach((zone, index) => {
    const last = segments[segments.length - 1];
    if (last && last.zone === zone) last.to = (index + 1) / WAKE_CELLS;
    else
      segments.push({
        zone,
        from: index / WAKE_CELLS,
        to: (index + 1) / WAKE_CELLS,
      });
  });
  return segments;
}

/** バーの位置 (0〜1) から、どのゾーンか。 */
export function wakeZoneAt(
  pos: number,
  segments: WakeSegment[],
): {
  zone: WakeZone;
  wake: number | null;
  label: string;
} {
  const segment =
    segments.find((item) => pos >= item.from && pos < item.to) ??
    segments[segments.length - 1];
  const found = WAKE_ZONES.find((item) => item.zone === segment.zone);
  if (!found) return { zone: "miss", wake: null, label: "二度寝!!" };
  return { zone: found.zone, wake: found.wake, label: found.label };
}
export type Weather = "sunny" | "cloudy" | "rain";
export const WEATHER_NAMES: Record<Weather, string> = {
  sunny: "晴れ",
  cloudy: "くもり",
  rain: "雨",
};
/** 天気の選ばれやすさ。 */
const WEATHER_WEIGHTS: Record<Weather, number> = {
  sunny: 0.5,
  cloudy: 0.3,
  rain: 0.2,
};
/** 雨の日は、転ぶと止まる時間が長い (すべって、起き上がりにくい)。 */
export const RAIN_STUN_SECONDS = 3;
/** 道のりの長さは、毎回、これだけ (割合) の範囲で変わる。 */
const ROUTE_VARIATION = 0.05;
/** 同じ天気が続くときの、選ばれにくさ。 */
const SAME_AS_LAST_PENALTY = 0.35;

/** その日の条件 (毎回変わる)。 */
export type Conditions = {
  /** 起きた時刻 (分) */
  wake: number;
  weather: Weather;
  /** 家から教室までの道のり (px) */
  routeLength: number;
};

export type Stage = "home" | "street" | "school";
/** 場面の切れ目 (道のりの位置)。家のドアと、校門。 */
export const STAGE_STARTS: { stage: Stage; from: number }[] = [
  { stage: "home", from: 0 },
  { stage: "street", from: 1500 },
  { stage: "school", from: 11800 },
];

/** scale: 道のりの割合 (難易度)。ふつうは 1。 */
export function stageAt(distance: number, scale = 1): Stage {
  let current: Stage = "home";
  for (const item of STAGE_STARTS)
    if (distance >= item.from * scale) current = item.stage;
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

// ---------------------------------------------------------------- 校舎の階段 (むずかしい)

/** 1 つの階段の段数 (1 階から 2 階へ、のように、1 つ上るのに必要な段)。 */
export const STAIR_STEPS = 12;
/** 教室がある階。1 階から数えるので、上る階段は、この数 − 1。 */
export const TOP_FLOOR = 6;
/** 階段の途中 (この段まで上ると) で、その階段のできごとが起きる。 */
export const STAIR_EVENT_STEP = 6;
/** 階段の先生と友達は、できごとが始まる段の、これだけ先に立っている (最初から見えている)。 */
export const STAIR_ACTOR_AHEAD = 3;

/** 階段のできごとの人が立つ段 (全体の段の数): 上る前から、そこに立っている。降りてくる人は、階段の上の踊り場。 */
export function stairActorStep(
  flight: number,
  kind: StairEvent["kind"],
): number {
  return kind === "walker"
    ? (flight + 1) * STAIR_STEPS
    : flight * STAIR_STEPS + STAIR_EVENT_STEP + STAIR_ACTOR_AHEAD;
}

/** 1 段上るたびに減る、スタミナ。 */
export const STAIR_COST = 2.2;
/** 同じ側を続けて押す (つまずく) と、止まる秒数。 */
export const STAIR_STUMBLE = 0.7;
/** 階段で人がおりてくる: よけられる秒数。 */
export const WALKER_WINDOW = 1;
/** 階段で先生に止められる: 動いてはいけない秒数。 */
export const STAIR_TEACHER_STOP = 1.6;
/** 先生に止められたのに動いた: 止まる秒数。 */
export const STAIR_SCOLD_STUN = 1.5;
/** 階段で友達と立ち話をする秒数。 */
export const STAIR_FRIEND_SECONDS = 2.5;

export type StairEvent = {
  kind: "walker" | "teacher" | "friend";
  /** 見た目・せりふの違い (0〜2)。毎回、ランダムに変わる */
  variant: number;
  phase: "idle" | "warn" | "stop" | "ask" | "talk" | "done";
  elapsed: number;
};

export type StairsState = {
  /** 階段に入った (教室までの道のりが終わった) */
  on: boolean;
  /** 上る階段の数 (階の数 − 1) */
  flights: number;
  /** 上った段の数 */
  steps: number;
  /** 息切れ中の、半端な段 (0〜1) */
  partial: number;
  /** 最後に押した側 (同じ側を続けて押すと、つまずく) */
  last: "left" | "right" | null;
  /** 最後に 1 段上がった時刻 (state.time)。足の動きに使う */
  lastStepAt: number;
  /** 階段ごとのできごと */
  plan: StairEvent[];
  /** 進行中のできごと (あるあいだは、上れない) */
  event: StairEvent | null;
};

export const STAIR_KINDS = ["walker", "teacher", "friend"] as const;

/** 階段の仕掛け: 階段が 1 つ増えるごとに、できごとを 1 つ (続けて同じ種類は避ける)。 */
function makeStairs(
  rand: () => number,
  difficulty: Difficulty,
): StairsState | null {
  const flights = DIFFICULTIES[difficulty].flights;
  if (flights <= 0) return null;
  const plan: StairEvent[] = [];
  let before: string | null = null;
  for (let k = 0; k < flights; k++) {
    const choices = STAIR_KINDS.filter((kind) => kind !== before);
    const kind =
      choices[
        Math.min(choices.length - 1, Math.floor(rand() * choices.length))
      ];
    before = kind;
    plan.push({
      kind,
      variant: Math.min(2, Math.floor(rand() * 3)),
      phase: "idle",
      elapsed: 0,
    });
  }
  return {
    on: false,
    flights,
    steps: 0,
    partial: 0,
    last: null,
    lastStepAt: -1,
    plan,
    event: null,
  };
}

/** いまの階 (1 階から、TOP_FLOOR まで)。 */
export function floorOf(stairs: StairsState): number {
  return Math.min(TOP_FLOOR, 1 + Math.floor(stairs.steps / STAIR_STEPS));
}

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
      /** 見た目・せりふの違い (0〜2)。毎回、ランダムに変わる */
      variant: number;
      phase: "idle" | "scold" | "done";
      taps: number;
      elapsed: number;
    }
  | {
      kind: "obasan";
      at: number;
      /** 見た目・せりふの違い (0〜2)。毎回、ランダムに変わる */
      variant: number;
      phase: "idle" | "ask" | "help" | "done";
      taps: number;
      elapsed: number;
      helped: boolean;
    }
  | {
      kind: "crossing";
      at: number;
      /** 見た目・せりふの違い (0〜2)。毎回、ランダムに変わる */
      variant: number;
      phase: "idle" | "ask" | "wait" | "dash" | "blocked" | "done";
      elapsed: number;
    }
  | {
      kind: "dog";
      at: number;
      /** 見た目・せりふの違い (0〜2)。毎回、ランダムに変わる */
      variant: number;
      phase: "idle" | "chase" | "done";
      elapsed: number;
      /** 犬との距離 (px)。0 になると、追いつかれる */
      gap: number;
    }
  | {
      kind: "vending";
      at: number;
      /** 見た目・せりふの違い (0〜2)。毎回、ランダムに変わる */
      variant: number;
      phase: "idle" | "ask" | "drink" | "done";
      elapsed: number;
    }
  | {
      kind: "friend";
      at: number;
      /** 見た目・せりふの違い (0〜2)。毎回、ランダムに変わる */
      variant: number;
      phase: "idle" | "ask" | "talk" | "done";
      elapsed: number;
    }
  | {
      kind: "bike";
      at: number;
      /** 見た目・せりふの違い (0〜2)。毎回、ランダムに変わる */
      variant: number;
      phase: "idle" | "warn" | "done";
      elapsed: number;
    }
  | {
      kind: "teacher";
      at: number;
      /** 見た目・せりふの違い (0〜2)。毎回、ランダムに変わる */
      variant: number;
      phase: "idle" | "greet" | "done";
      taps: number;
      elapsed: number;
    };

export type EventKind = GameEvent["kind"];

/** 障害物の種類: バッグ、ごみ箱、水たまり (雨の日)、猫。 */
export type ObstacleKind = "bag" | "bin" | "puddle" | "cat";

export type Obstacle = {
  kind: ObstacleKind;
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
  status: "ready" | "waking" | "playing" | "arrived" | "late";
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
  difficulty: Difficulty;
  mode: Mode;
  /** 校舎の階段 (むずかしいだけ。教室までの道のりが終わると、始まる) */
  stairs: StairsState | null;
  /** 起きた時刻 (分)。時刻は、ここから進む。起床チャレンジで決まる */
  startMinute: number;
  /** 起床チャレンジ (目覚ましのバー) */
  wake: {
    /** バーの往復の速さ (毎回、少し違う) */
    speed: number;
    /** バーの色の並び (毎回ランダム) */
    segments: WakeSegment[];
    /** 動き出すときの、バーの位置 (往復のどこから始まるか。毎回ランダム) */
    start: number;
    elapsed: number;
    /** バーの位置 (0〜1) */
    pos: number;
    stopped: boolean;
    /** 止めてから、結果を見せている時間 (秒) */
    pause: number;
    zone: WakeZone | null;
    label: string;
  };
  /** 二度寝して、起きられなかった (即遅刻) */
  slept: boolean;
  weather: Weather;
  /** 家から教室までの道のり (px) */
  routeLength: number;
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
    stumbles: number;
    stairDodged: number;
    stairHit: number;
    stairScolded: number;
    stairChatted: boolean;
  };
};

function makeEvent(kind: EventKind, at: number, variant = 0): GameEvent {
  switch (kind) {
    case "mother":
      return { kind, at, variant, phase: "idle", taps: 0, elapsed: 0 };
    case "teacher":
      return { kind, at, variant, phase: "idle", taps: 0, elapsed: 0 };
    case "obasan":
      return {
        kind,
        at,
        variant,
        phase: "idle",
        taps: 0,
        elapsed: 0,
        helped: false,
      };
    case "dog":
      return {
        kind,
        at,
        variant,
        phase: "idle",
        elapsed: 0,
        gap: DOG_START_GAP,
      };
    default:
      return { kind, at, variant, phase: "idle", elapsed: 0 };
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
  difficulty: Difficulty = "normal",
): GameEvent[] {
  const { eventCount, routeScale } = DIFFICULTIES[difficulty];
  let kinds: EventKind[];
  if (forced) {
    kinds = forced;
  } else {
    const r = rand();
    // ふつう: 1〜3 (1: 15%、2: 45%、3: 40%)。ほかは、最小と最大のあいだで、半々
    const count =
      difficulty === "normal"
        ? r < 0.15
          ? 1
          : r < 0.6
            ? 2
            : 3
        : eventCount[0] + (r < 0.5 ? 0 : eventCount[1] - eventCount[0]);
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
  // 置ける場所がせまいものから置く (あとから置くものが、場所を取られて、減らないように)
  const width = (kind: EventKind) =>
    EVENT_SLOTS[kind].to - EVENT_SLOTS[kind].from;
  for (const kind of [...kinds].sort((x, y) => width(x) - width(y))) {
    const slot = EVENT_SLOTS[kind];
    for (let attempt = 0; attempt < 40; attempt++) {
      const at = (slot.from + rand() * (slot.to - slot.from)) * routeScale;
      if (
        events.every(
          (item) => Math.abs(item.at - at) >= MIN_EVENT_GAP * routeScale,
        )
      ) {
        events.push(makeEvent(kind, at, Math.floor(rand() * 3)));
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
  options: {
    recent?: string[][];
    kinds?: EventKind[];
    /** 条件を決める (テスト用。決めなければ、ランダム) */
    conditions?: Partial<Conditions>;
    /** 前回の条件。同じ天気が続きにくくする */
    previous?: { weather?: string };
    /** 難易度 (決めなければ、ふつう) */
    difficulty?: Difficulty;
    /** モード (決めなければ、通常) */
    mode?: Mode;
  } = {},
): GameState {
  const difficulty = options.difficulty ?? "normal";
  const conditions = pickConditions(
    rand,
    options.previous,
    options.conditions,
    difficulty,
  );
  const events = pickEvents(
    rand,
    options.recent ?? [],
    options.kinds,
    difficulty,
  );
  const routeLength = conditions.routeLength;

  const minGap = RUN_SPEED * DASH_RATE * BOOST_RATE * (AIR_TIME + 0.12);
  const obstacles: Obstacle[] = [];
  let x = 1900;
  while (x < routeLength - 700) {
    const kind = pickObstacleKind(rand, conditions.weather);
    const size = OBSTACLE_SIZES[kind];
    const width =
      size.width[0] + Math.floor(rand() * (size.width[1] - size.width[0]));
    const height =
      size.height[0] + Math.floor(rand() * (size.height[1] - size.height[0]));
    const blocking = events.find(
      (event) => x + width > event.at - 500 && x < event.at + 400,
    );
    if (blocking) {
      x = blocking.at + 400;
      continue;
    }
    obstacles.push({ kind, at: x, width, height, hit: false });
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
    difficulty,
    mode: options.mode ?? "normal",
    startMinute: conditions.wake,
    wake: wakeStart(rand, difficulty),
    slept: false,
    weather: conditions.weather,
    routeLength,
    obstacles,
    events,
    active: null,
    chase: null,
    stairs: makeStairs(rand, difficulty),
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
      stumbles: 0,
      stairDodged: 0,
      stairHit: 0,
      stairScolded: 0,
      stairChatted: false,
    },
  };
}

/** 起床チャレンジの始まり: 色の並び、バーの速さ、動き出す位置を、ランダムに決める。 */
function wakeStart(
  rand: () => number,
  difficulty: Difficulty,
): GameState["wake"] {
  const segments = buildWakeSegments(rand, difficulty);
  const { wakeSpeed } = DIFFICULTIES[difficulty];
  const speed = wakeSpeed.min + rand() * wakeSpeed.range;
  const start = rand() * 2;
  return {
    speed,
    segments,
    start,
    elapsed: 0,
    pos: wakePosition(0, speed, start),
    stopped: false,
    pause: 0,
    zone: null,
    label: "",
  };
}

/** 障害物の大きさ (世界の px)。バッグが、いちばん高い。 */
const OBSTACLE_SIZES: Record<
  ObstacleKind,
  { width: [number, number]; height: [number, number] }
> = {
  bag: { width: [18, 36], height: [22, 48] },
  bin: { width: [20, 30], height: [28, 40] },
  puddle: { width: [34, 52], height: [6, 8] },
  cat: { width: [16, 22], height: [18, 26] },
};

/** 天気ごとの、障害物の種類の割合。雨の日は、水たまりが多い。 */
const OBSTACLE_WEIGHTS: Record<Weather, Record<ObstacleKind, number>> = {
  sunny: { bag: 0.55, bin: 0.25, puddle: 0, cat: 0.2 },
  cloudy: { bag: 0.55, bin: 0.25, puddle: 0, cat: 0.2 },
  rain: { bag: 0.35, bin: 0.15, puddle: 0.5, cat: 0 },
};

function pickObstacleKind(rand: () => number, weather: Weather): ObstacleKind {
  const weights = OBSTACLE_WEIGHTS[weather];
  let t = rand();
  for (const kind of Object.keys(weights) as ObstacleKind[]) {
    t -= weights[kind];
    if (t < 0) return kind;
  }
  return "bag";
}

/**
 * その日の条件 (天気・道のりの長さ)。前回と同じ天気は、選ばれにくい。
 * 起きた時刻は、ここでは 8:00 にしておく (本当の時刻は、起床チャレンジで決まる)。
 */
function pickConditions(
  rand: () => number,
  previous: { weather?: string } | undefined,
  fixed: Partial<Conditions> | undefined,
  difficulty: Difficulty = "normal",
): Conditions {
  const weighted = <T>(items: { value: T; weight: number }[]): T => {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let t = rand() * total;
    for (const item of items) {
      t -= item.weight;
      if (t < 0) return item.value;
    }
    return items[items.length - 1].value;
  };
  const weather =
    fixed?.weather ??
    weighted(
      (Object.keys(WEATHER_WEIGHTS) as Weather[]).map((value) => ({
        value,
        weight:
          WEATHER_WEIGHTS[value] *
          (previous?.weather === value ? SAME_AS_LAST_PENALTY : 1),
      })),
    );
  const routeLength =
    fixed?.routeLength ??
    Math.round(
      ROUTE_LENGTH *
        DIFFICULTIES[difficulty].routeScale *
        (1 + (rand() * 2 - 1) * ROUTE_VARIATION),
    );
  return { wake: fixed?.wake ?? START_MINUTE, weather, routeLength };
}

/** いまの時刻 (分。0:00 からの経過)。 */
export function clockMinute(state: GameState): number {
  return state.startMinute + state.time;
}

export function scoreOf(state: GameState): number {
  return Math.floor(state.distance / PX_PER_METER);
}

/** 転んだときに止まる秒数: 雨の日は、長い。 */
export function stunSeconds(state: GameState): number {
  return state.weather === "rain" ? RAIN_STUN_SECONDS : STUN_SECONDS;
}

export function startGame(state: GameState): void {
  state.status = "playing";
}

/** 起床チャレンジを始める (ふとんの中で、目覚ましが鳴る。バーが動き出す)。 */
export function startWake(state: GameState): void {
  state.status = "waking";
}

/** 起きた時刻を決める。寝坊の日は、雨をくもりにし、できごとを 2 つまでにする。 */
export function applyWake(state: GameState, wake: number): void {
  state.startMinute = wake;
  if (wake < LATE_WAKE) return;
  if (state.weather === "rain") {
    state.weather = "cloudy";
    // 水たまりは、ごみ箱にする (くもりの日には、水たまりがないため)
    for (const obstacle of state.obstacles) {
      if (obstacle.kind === "puddle") {
        obstacle.kind = "bin";
        obstacle.width = 24;
        obstacle.height = 30;
      }
    }
  }
  const cap = DIFFICULTIES[state.difficulty].lateEventCap;
  if (state.events.length > cap) state.events = state.events.slice(0, cap);
}

/** 目覚ましを止める (タップ / スペース)。止めた位置で、起きた時刻が決まる。 */
export function pressWake(state: GameState): void {
  const wake = state.wake;
  if (state.status !== "waking" || wake.stopped) return;
  wake.stopped = true;
  wake.pause = 0;
  const result = wakeZoneAt(wake.pos, wake.segments);
  wake.zone = result.zone;
  wake.label = result.label;
}

/** バーの位置: 0 → 1 → 0 と、一定の速さで往復する。start は、動き出す位置 (0〜2)。 */
function wakePosition(elapsed: number, speed: number, start: number): number {
  const t = (start + elapsed * speed) % 2;
  return t < 1 ? t : 2 - t;
}

function stepWake(state: GameState, dt: number): void {
  const wake = state.wake;
  if (!wake.stopped) {
    wake.elapsed += dt;
    wake.pos = wakePosition(wake.elapsed, wake.speed, wake.start);
    if (wake.elapsed >= WAKE_TIME_LIMIT) {
      // 止めなかった: 二度寝
      wake.stopped = true;
      wake.pause = 0;
      wake.zone = "miss";
      wake.label = "二度寝!!";
    }
    return;
  }
  wake.pause += dt;
  if (wake.pause < WAKE_PAUSE) return;
  const zone = WAKE_ZONES.find((item) => item.zone === wake.zone);
  if (zone === undefined) {
    // 二度寝: 起きられず、即遅刻
    state.slept = true;
    state.status = "late";
  } else {
    applyWake(state, zone.wake);
    state.status = "playing";
  }
}

/** 起床チャレンジの表示用 (バーの位置、止めたか、結果)。 */
export type WakeView = {
  stopped: boolean;
  zone: WakeZone | null;
  label: string;
  /** 起きた時刻 (二度寝のときは、null) */
  clock: string | null;
};

export function wakeView(state: GameState): WakeView | null {
  if (state.status !== "waking") return null;
  const wake = state.wake;
  const zone = WAKE_ZONES.find((item) => item.zone === wake.zone);
  return {
    stopped: wake.stopped,
    zone: wake.zone,
    label: wake.label,
    clock: zone ? clockText(zone.wake) : null,
  };
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
    state.stamina -= STAMINA_DRAIN * DIFFICULTIES[state.difficulty].drain * dt;
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
    state.stairs?.on !== true &&
    state.active === null &&
    state.stun <= 0 &&
    state.y === 0
  ) {
    state.vy = JUMP_SPEED;
  }
}

/** 押された (タップ / スペース): できごとの最中は、連打や合図。ふだんは、ジャンプ。 */
export function press(state: GameState): void {
  if (state.status === "waking") {
    pressWake(state);
    return;
  }
  if (state.status !== "playing") return;
  if (state.stairs?.on === true) {
    pressStairs(state, state.stairs);
    return;
  }
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
  if (state.stairs?.on === true) {
    chooseStairs(state.stairs, option);
    return;
  }
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
        kind: "bag",
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

// ---------------------------------------------------------------- 階段の動き

/** 階段で、足を出す。← と → を、交互に押すと、1 段ずつ上る (同じ側を続けると、つまずく)。 */
export function climb(state: GameState, side: "left" | "right"): void {
  const stairs = state.stairs;
  if (state.status !== "playing" || stairs === null || !stairs.on) return;
  if (state.stun > 0) return;
  const event = stairs.event;
  if (event !== null) {
    if (event.kind === "teacher" && event.phase === "stop") {
      // 動いてしまった: 先生に怒られる
      event.phase = "done";
      stairs.event = null;
      state.tags.stairScolded += 1;
      state.stun = STAIR_SCOLD_STUN;
    }
    // ほかのできごとの最中は、上れない
    return;
  }
  if (stairs.last === side) {
    // 同じ側の足を、続けて出した: つまずく
    stairs.last = null;
    state.stun = STAIR_STUMBLE;
    state.tags.stumbles += 1;
    return;
  }
  stairs.last = side;
  // 息切れ中は、1 段上るのに、何度も押す
  stairs.partial += state.exhausted ? EXHAUSTED_RATE : 1;
  while (stairs.partial >= 1 - 1e-9) {
    stairs.partial -= 1;
    stairs.steps += 1;
  }
  stairs.partial = Math.max(0, stairs.partial);
  stairs.lastStepAt = state.time;
  state.stamina -= STAIR_COST * DIFFICULTIES[state.difficulty].drain;
  if (state.stamina <= 0) {
    state.stamina = 0;
    if (!state.exhausted) {
      state.exhausted = true;
      state.tags.exhausted += 1;
    }
  }
}

/** 階段で押された (タップ / スペース): 降りてくる人をよける。 */
function pressStairs(state: GameState, stairs: StairsState): void {
  const event = stairs.event;
  if (event !== null && event.kind === "walker" && event.phase === "warn") {
    event.phase = "done";
    stairs.event = null;
    state.tags.stairDodged += 1;
  }
}

/** 階段で選ぶ: 友達と、立ち話をするか。 */
function chooseStairs(stairs: StairsState, option: 0 | 1): void {
  const event = stairs.event;
  if (event === null || event.kind !== "friend" || event.phase !== "ask")
    return;
  if (option === 0) {
    event.phase = "talk";
    event.elapsed = 0;
  } else {
    event.phase = "done";
    stairs.event = null;
  }
}

function stepStairs(state: GameState, stairs: StairsState, dt: number): void {
  // スタミナは、休んでいるあいだに戻る
  state.stamina = Math.min(STAMINA_MAX, state.stamina + RECOVER * dt);
  if (state.exhausted && state.stamina >= RECOVER_AT) state.exhausted = false;
  if (state.stun > 0) state.stun = Math.max(0, state.stun - dt);

  const event = stairs.event;
  if (event !== null) {
    event.elapsed += dt;
    if (event.kind === "walker" && event.phase === "warn") {
      if (event.elapsed >= WALKER_WINDOW) {
        // よけられなかった: ぶつかって、転ぶ
        event.phase = "done";
        stairs.event = null;
        state.tags.stairHit += 1;
        state.stun = STUN_SECONDS;
      }
    } else if (event.kind === "teacher" && event.phase === "stop") {
      if (event.elapsed >= STAIR_TEACHER_STOP) {
        event.phase = "done";
        stairs.event = null;
      }
    } else if (event.kind === "friend" && event.phase === "talk") {
      if (event.elapsed >= STAIR_FRIEND_SECONDS) {
        event.phase = "done";
        stairs.event = null;
        state.tags.stairChatted = true;
        state.stamina = Math.min(STAMINA_MAX, state.stamina + FRIEND_STAMINA);
        if (state.exhausted && state.stamina >= RECOVER_AT) {
          state.exhausted = false;
        }
      }
    }
  } else if (state.stun <= 0) {
    // その階段の、できごとの始まり
    const planned = stairs.plan[Math.floor(stairs.steps / STAIR_STEPS)];
    if (
      planned !== undefined &&
      planned.phase === "idle" &&
      stairs.steps % STAIR_STEPS >= STAIR_EVENT_STEP
    ) {
      planned.phase =
        planned.kind === "walker"
          ? "warn"
          : planned.kind === "teacher"
            ? "stop"
            : "ask";
      planned.elapsed = 0;
      stairs.event = planned;
    }
  }

  if (stairs.steps >= stairs.flights * STAIR_STEPS) {
    state.status = "arrived";
  } else if (
    state.mode !== "timeattack" &&
    clockMinute(state) >= DEADLINE_MINUTE
  ) {
    state.status = "late";
  }
}

/** 階段の表示用 (画面の文字に使う)。階段に入っていないときは null。 */
export type StairsView = {
  floor: number;
  /** 階段に入った直後 (まだ 1 段も上っていない) */
  intro: boolean;
  kind: StairEvent["kind"] | null;
  phase: string;
  variant: number;
};

export function stairsView(state: GameState): StairsView | null {
  const stairs = state.stairs;
  if (state.status !== "playing" || stairs === null || !stairs.on) return null;
  const event = stairs.event;
  return {
    floor: floorOf(stairs),
    intro: stairs.steps === 0,
    kind: event ? event.kind : null,
    phase: event ? event.phase : "",
    variant: event ? event.variant : 0,
  };
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
  /** 見た目・せりふの違い (0〜2) */
  variant: number;
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
      variant: dog.variant,
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
    variant: event.variant,
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
      state.stun = stunSeconds(state);
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
  if (state.status === "waking") {
    stepWake(state, dt);
    return;
  }
  if (state.status !== "playing") return;
  state.time += dt;

  // 校舎の階段 (むずかしい): 教室までの道のりが終わると、上る
  if (state.stairs !== null && state.stairs.on) {
    stepStairs(state, state.stairs, dt);
    return;
  }

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
    state.distance = Math.min(state.routeLength, state.distance + speed * dt);

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
          state.stun = stunSeconds(state);
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
      state.stun = stunSeconds(state);
      state.tags.bitten = true;
    } else if (dog.elapsed >= DOG_SECONDS) {
      dog.phase = "done";
      state.chase = null;
      state.tags.dogEscaped = true;
    }
  }

  if (state.distance >= state.routeLength) {
    if (state.stairs !== null && !state.stairs.on) {
      // 校舎に着いた: 階段へ (教室は、6 階)
      state.stairs.on = true;
      state.pace = "normal";
      state.boost = 0;
      state.y = 0;
      state.vy = 0;
      state.chase = null;
    } else {
      state.status = "arrived";
    }
  } else if (
    state.mode !== "timeattack" &&
    clockMinute(state) >= DEADLINE_MINUTE
  ) {
    state.status = "late";
  }
}

// ---------------------------------------------------------------- 点数 (通常モード)

/** 余裕 1 分あたりの点。 */
export const MARGIN_POINTS = 10;
export type ScoreLine = { label: string; points: number };

/** 点数の内訳: 余裕と、いい行い (プラス) と、悪い行い (マイナス)。 */
export function scoreBreakdown(state: GameState, margin: number): ScoreLine[] {
  const t = state.tags;
  const lines: ScoreLine[] = [
    { label: `余裕 ${margin} 分`, points: margin * MARGIN_POINTS },
  ];
  if (t.helped) lines.push({ label: "おばさんを助けた", points: 50 });
  if (t.greeted) lines.push({ label: "校門であいさつした", points: 30 });
  if (t.dogEscaped) lines.push({ label: "犬から逃げ切った", points: 20 });
  if (t.bikeDodged) lines.push({ label: "自転車をよけた", points: 20 });
  if (t.stairDodged > 0) {
    lines.push({
      label: `階段で人をよけた ×${t.stairDodged}`,
      points: 15 * t.stairDodged,
    });
  }
  if (t.ignored) lines.push({ label: "おばさんを見て見ぬふり", points: -30 });
  if (t.stairScolded > 0) {
    lines.push({
      label: `階段で先生に怒られた ×${t.stairScolded}`,
      points: -20 * t.stairScolded,
    });
  }
  if (t.falls > 0) {
    lines.push({ label: `転んだ ×${t.falls}`, points: -5 * t.falls });
  }
  return lines;
}

export type Grade = "S" | "A" | "B" | "C" | "D";

/** 点数から、評価 (S〜D)。 */
export function gradeOf(score: number): Grade {
  if (score >= 600) return "S";
  if (score >= 450) return "A";
  if (score >= 300) return "B";
  if (score >= 150) return "C";
  return "D";
}

/** 終わったあとの、結果の文。 */
export type Summary = {
  mode: Mode;
  /** 点数 (通常モードで着いたときだけ。マイナスにはならない。遅刻と、タイムアタックは 0) */
  score: number;
  grade: Grade | null;
  breakdown: ScoreLine[];
  /** 家を出てから教室に着くまで (秒。0.1 秒まで) */
  elapsed: number;
  outcome: "arrived" | "late";
  /** 着いた時刻 (遅刻のときは、9:15) */
  arrival: string;
  /** 何分余裕で着いたか (遅刻は 0) */
  margin: number;
  /** 遅刻のとき: 教室まで、あと何 m だったか (階段で時間切れのときは 0) */
  remaining: number;
  /** 階段 (むずかしい) に入ったとき、いた階。入っていなければ null */
  stairsFloor: number | null;
  notes: string[];
};

export function summarize(state: GameState): Summary {
  const arrived = state.status === "arrived";
  const stairsOn = state.stairs?.on === true;
  // 二度寝は、時間がたっていなくても、遅刻 (9:15)
  const clock = state.slept
    ? DEADLINE_MINUTE
    : Math.min(DEADLINE_MINUTE, clockMinute(state));
  const notes: string[] = [];
  const { tags } = state;
  if (state.slept) notes.push("二度寝してしまった…");
  else if (state.wake.zone !== null) {
    notes.push(`${clockText(state.startMinute)} 起床 (${state.wake.label})`);
  }
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
  if (tags.stairDodged > 0) notes.push("階段で人をよけた");
  if (tags.stairHit > 0) notes.push("階段で人とぶつかった");
  if (tags.stairScolded > 0) notes.push("階段で先生に怒られた");
  if (tags.stairChatted) notes.push("階段で友達からおにぎりをもらった");
  if (tags.stumbles > 0) notes.push(`階段でつまずいた ${tags.stumbles} 回`);
  if (tags.falls > 0) notes.push(`転んだ ${tags.falls} 回`);
  if (tags.exhausted > 0) notes.push(`息切れした ${tags.exhausted} 回`);
  const scored = arrived && state.mode === "normal";
  const margin = arrived ? Math.max(0, Math.floor(DEADLINE_MINUTE - clock)) : 0;
  const breakdown = scored ? scoreBreakdown(state, margin) : [];
  const score = Math.max(
    0,
    breakdown.reduce((sum, line) => sum + line.points, 0),
  );
  return {
    mode: state.mode,
    score,
    grade: scored ? gradeOf(score) : null,
    breakdown,
    elapsed: Math.round(state.time * 10) / 10,
    outcome: arrived ? "arrived" : "late",
    arrival: clockText(clock),
    margin,
    remaining:
      arrived || stairsOn
        ? 0
        : Math.ceil((state.routeLength - state.distance) / PX_PER_METER),
    stairsFloor:
      state.stairs !== null && stairsOn ? floorOf(state.stairs) : null,
    notes,
  };
}
