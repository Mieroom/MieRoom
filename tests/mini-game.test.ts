import { describe, expect, it } from "vitest";
import {
  AIR_TIME,
  BIKE_LEAD,
  BIKE_SPEED,
  BLOCKED_SECONDS,
  BOOST_RATE,
  BOOST_SECONDS,
  canPlayMiniGame,
  choose,
  clockMinute,
  clockText,
  createGame,
  CROSSING_WAIT,
  DASH_RATE,
  DASH_CLOSE,
  DASH_OPEN,
  DEADLINE_MINUTE,
  DOG_SECONDS,
  DOG_START_GAP,
  FRIEND_STAMINA,
  FRIEND_SECONDS,
  EVENT_KINDS,
  EVENT_SLOTS,
  EXHAUSTED_RATE,
  eventView,
  isMiniGamePhrase,
  jump,
  MOTHER_MAX,
  MOTHER_TAPS,
  OBASAN_TAPS,
  opensMiniGame,
  press,
  RECOVER_AT,
  ROUTE_LENGTH,
  RUN_SPEED,
  setPace,
  SLOW_RATE,
  STAMINA_DRAIN,
  STAMINA_MAX,
  scoreOf,
  stageAt,
  START_MINUTE,
  startGame,
  RAIN_STUN_SECONDS,
  STUN_SECONDS,
  stepGame,
  stunSeconds,
  summarize,
  TEACHER_MAX,
  TEACHER_TAPS,
  VENDING_SECONDS,
  applyWake,
  buildWakeSegments,
  courseSeed,
  gradeOf,
  isMode,
  jstDayKey,
  MODE_IDS,
  seededRandom,
  climb,
  DIFFICULTY_IDS,
  floorOf,
  isDifficulty,
  STAIR_ACTOR_AHEAD,
  stairActorStep,
  STAIR_EVENT_STEP,
  STAIR_FRIEND_SECONDS,
  STAIR_SCOLD_STUN,
  STAIR_STEPS,
  STAIR_STUMBLE,
  STAIR_TEACHER_STOP,
  stairsView,
  TOP_FLOOR,
  WALKER_SPEED,
  WALKER_START_STEP,
  type Difficulty,
  WAKE_CELLS,
  type WakeZone,
  press as pressKey,
  startWake,
  wakeView,
  wakeZoneAt,
  WAKE_OPTIONS,
  WAKE_PAUSE,
  WAKE_TIME_LIMIT,
  WAKE_ZONES,
  type Weather,
  type EventKind,
  type GameState,
} from "@/lib/domain/mini-game";

// ミニゲーム「遅刻ダッシュ」: 合言葉、時刻、できごと (8 種類)、転ぶ、着く / 遅刻。

const fixed = (value: number) => () => value;
/** いつもの日: 8:00 起床、晴れ、決まった道のり。(条件がランダムでも、規則の確認は、ぶれない) */
const TODAY = {
  wake: START_MINUTE,
  weather: "sunny" as const,
  routeLength: ROUTE_LENGTH,
};
/** rand = 0 のゲーム: お母さん (150)、おばさん (3200)、踏切 (8000) の 3 つが起きる。 */
function newGame(
  rand: () => number = fixed(0),
  kinds: EventKind[] = ["mother", "obasan", "crossing"],
): GameState {
  const state = createGame(rand, { kinds, conditions: TODAY });
  startGame(state);
  return state;
}
/** 種類を決めて、その 1 つだけが起きるゲーム (位置は、起きうる範囲の始め)。 */
function onlyGame(kind: EventKind): GameState {
  const state = createGame(fixed(0), { kinds: [kind], conditions: TODAY });
  clearObstacles(state);
  startGame(state);
  return state;
}
function run(state: GameState, seconds: number, step = 0.05) {
  for (let t = 0; t < seconds; t += step) stepGame(state, step);
}
/** 障害物を消して、できごとの確認だけをする。 */
function clearObstacles(state: GameState) {
  state.obstacles = [];
}
function event<K extends EventKind>(state: GameState, kind: K) {
  const found = state.events.find((item) => item.kind === kind);
  if (!found) throw new Error(`no ${kind}`);
  return found as Extract<(typeof state.events)[number], { kind: K }>;
}

describe("合言葉 (先生一覧の「名前で絞る」)", () => {
  it("合言葉と、その読みだけが合う。空白と全角・半角の違いは見ない", () => {
    expect(isMiniGamePhrase("遅刻ダッシュ")).toBe(true);
    expect(isMiniGamePhrase("  遅刻 ダッシュ  ")).toBe(true);
    expect(isMiniGamePhrase("ちこくだっしゅ")).toBe(true);
    expect(isMiniGamePhrase("遅刻ﾀﾞｯｼｭ")).toBe(true); // 半角カナ
  });
  it("ほかの文字・空・未指定は合わない", () => {
    for (const value of ["", " ", "遅刻", "田中", undefined, null]) {
      expect(isMiniGamePhrase(value), String(value)).toBe(false);
    }
  });
});

describe("学生と時間割管理者だけ", () => {
  it("遊べるのは学生と時間割管理者だけ。先生は、遊べない", () => {
    expect(canPlayMiniGame("student")).toBe(true);
    expect(canPlayMiniGame("admin")).toBe(true);
    for (const role of ["teacher", "", "STUDENT", "ADMIN", "x"]) {
      expect(canPlayMiniGame(role), role).toBe(false);
    }
  });
  it("入り口は、学生か時間割管理者が合言葉を入れたときだけ開く。先生は、ふつうの絞り込み", () => {
    expect(opensMiniGame("student", "遅刻ダッシュ")).toBe(true);
    expect(opensMiniGame("admin", "遅刻ダッシュ")).toBe(true);
    expect(opensMiniGame("teacher", "遅刻ダッシュ")).toBe(false);
    expect(opensMiniGame("student", "田中")).toBe(false);
    expect(opensMiniGame("student", undefined)).toBe(false);
  });
});

describe("時刻と場面", () => {
  it("8:00 に始まる。分は 2 けた。9:15 が締め切り", () => {
    expect(clockText(START_MINUTE)).toBe("8:00");
    expect(clockText(8 * 60 + 5.9)).toBe("8:05");
    expect(clockText(DEADLINE_MINUTE)).toBe("9:15");
  });
  it("場面: 家 → 道 → 校舎", () => {
    expect(stageAt(0)).toBe("home");
    expect(stageAt(1499)).toBe("home");
    expect(stageAt(1500)).toBe("street");
    expect(stageAt(11800)).toBe("school");
  });
  it("現実の 1 秒が、ゲームの 1 分", () => {
    const state = newGame();
    stepGame(state, 1);
    expect(clockMinute(state)).toBe(START_MINUTE + 1);
  });
});

describe("ゲームの作り方 (できごと・障害物)", () => {
  function seeded(seed: number) {
    let n = seed + 1;
    return () => {
      n = (n * 16807) % 2147483647;
      return n / 2147483647;
    };
  }
  it("できごとは 1〜3 つ。種類は重ならない。位置は、それぞれの範囲の中で、互いに離れている", () => {
    for (let seed = 0; seed < 300; seed++) {
      const state = createGame(seeded(seed));
      expect(state.events.length).toBeGreaterThanOrEqual(1);
      expect(state.events.length).toBeLessThanOrEqual(3);
      expect(new Set(state.events.map((item) => item.kind)).size).toBe(
        state.events.length,
      );
      for (const item of state.events) {
        const slot = EVENT_SLOTS[item.kind];
        expect(item.at, `${seed}: ${item.kind}`).toBeGreaterThanOrEqual(
          slot.from,
        );
        expect(item.at, `${seed}: ${item.kind}`).toBeLessThanOrEqual(slot.to);
      }
      for (let k = 1; k < state.events.length; k++) {
        expect(
          state.events[k].at - state.events[k - 1].at,
        ).toBeGreaterThanOrEqual(1200);
      }
    }
  });
  it("できごとは 8 種類。どれも、選ばれることがある", () => {
    expect(EVENT_KINDS).toHaveLength(8);
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      for (const item of createGame(seeded(seed)).events) seen.add(item.kind);
    }
    expect([...seen].sort()).toEqual([...EVENT_KINDS].sort());
  });
  it("前回に出たできごとは、出にくい (2 回続けて同じものは、少ない)", () => {
    const count = (recent: string[][]) => {
      let hits = 0;
      for (let seed = 0; seed < 1500; seed++) {
        const events = createGame(seeded(seed * 7 + 3), { recent }).events;
        if (events.some((item) => item.kind === "obasan")) hits += 1;
      }
      return hits;
    };
    const plain = count([]);
    const afterLast = count([["obasan"]]);
    const afterTwo = count([[], ["obasan"]]);
    expect(afterLast).toBeLessThan(plain * 0.5);
    expect(afterTwo).toBeLessThan(plain);
    expect(afterTwo).toBeGreaterThan(afterLast);
    // 完全には止めない (種類が少なくても、選べる)
    expect(afterLast).toBeGreaterThan(0);
  });
  it("種類を指定すると、その種類だけが起きる。乱数が 0 のときは、1 つだけ起きる", () => {
    expect(createGame(fixed(0)).events).toHaveLength(1);
    const state = createGame(fixed(0.5), {
      kinds: ["dog", "bike"],
      conditions: TODAY,
    });
    expect(state.events.map((item) => item.kind)).toEqual(["dog", "bike"]);
  });
  it("障害物は、家の中とできごとの前後に置かない。間隔は、跳び越えられる長さより長い", () => {
    for (let seed = 0; seed < 100; seed++) {
      let n = seed + 7;
      const rand = () => {
        n = (n * 48271) % 2147483647;
        return n / 2147483647;
      };
      const state = createGame(rand);
      const list = state.obstacles;
      expect(list.length).toBeGreaterThan(5);
      for (const [index, item] of list.entries()) {
        expect(item.at).toBeGreaterThanOrEqual(1900);
        for (const e of state.events) {
          const inside =
            item.at + item.width > e.at - 500 && item.at < e.at + 400;
          expect(inside, `${seed}: ${item.at} vs ${e.kind}`).toBe(false);
        }
        if (index > 0) {
          const gap = item.at - (list[index - 1].at + list[index - 1].width);
          // ダッシュ + 飴で、いちばん速いときでも、空中にいる距離より長い
          expect(gap).toBeGreaterThan(
            RUN_SPEED * DASH_RATE * BOOST_RATE * AIR_TIME,
          );
        }
      }
    }
  });
});

describe("走る・跳ぶ・着く・遅刻", () => {
  it("始める前は進まない。始めると進み、点数 (m) になる", () => {
    const state = createGame(fixed(0.99), { conditions: TODAY });
    stepGame(state, 1);
    expect(state.distance).toBe(0);
    startGame(state);
    clearObstacles(state);
    state.events = [];
    stepGame(state, 1);
    expect(state.distance).toBeGreaterThan(250);
    expect(scoreOf(state)).toBeGreaterThan(20);
  });
  it("地面にいるときだけ跳べる。空中で、もう一度は跳べない。着地すると 0 に戻る", () => {
    const state = newGame();
    state.events = [];
    clearObstacles(state);
    jump(state);
    stepGame(state, 0.1);
    expect(state.y).toBeGreaterThan(0);
    const velocity = state.vy;
    jump(state);
    expect(state.vy).toBe(velocity);
    for (let i = 0; i < 100 && state.y > 0; i++) stepGame(state, 0.02);
    expect(state.y).toBe(0);
  });
  it("まっすぐ走ると、約 56 秒で教室に着く。余裕は 9:15 までの残り", () => {
    const state = newGame(fixed(0.99));
    state.events = [];
    clearObstacles(state);
    run(state, 70);
    expect(state.status).toBe("arrived");
    const summary = summarize(state);
    expect(summary.outcome).toBe("arrived");
    expect(summary.margin).toBeGreaterThan(15);
    expect(summary.arrival).toMatch(/^8:5\d$/);
  });
  it("9:15 までに着けなければ遅刻。そのあとは進まない", () => {
    const state = newGame();
    state.events = [];
    clearObstacles(state);
    state.distance = 100;
    state.time = DEADLINE_MINUTE - START_MINUTE - 0.5;
    stepGame(state, 1);
    expect(state.status).toBe("late");
    const summary = summarize(state);
    expect(summary.outcome).toBe("late");
    expect(summary.arrival).toBe("9:15");
    expect(summary.margin).toBe(0);
    expect(summary.remaining).toBeGreaterThan(0);
    const distance = state.distance;
    stepGame(state, 5);
    expect(state.distance).toBe(distance);
  });
  it("道のりの終わりを超えて進まない", () => {
    const state = newGame(fixed(0.99));
    state.events = [];
    clearObstacles(state);
    state.distance = ROUTE_LENGTH - 5;
    stepGame(state, 1);
    expect(state.distance).toBe(ROUTE_LENGTH);
    expect(state.status).toBe("arrived");
  });
});

describe("転ぶ", () => {
  it("障害物にぶつかると、2 秒止まる。同じ障害物には、二度ぶつからない。時刻は進む", () => {
    const state = newGame(fixed(0.99));
    state.events = [];
    state.obstacles = [
      { kind: "bag", at: 400, width: 30, height: 40, hit: false },
    ];
    state.distance = 400 - 10; // 障害物が、キャラの体に重なる位置
    stepGame(state, 0.016);
    expect(state.stun).toBe(STUN_SECONDS);
    expect(state.tags.falls).toBe(1);
    const distance = state.distance;
    const before = clockMinute(state);
    run(state, 1);
    expect(state.distance).toBe(distance);
    expect(clockMinute(state)).toBeGreaterThan(before + 0.9);
    run(state, 1.5);
    expect(state.stun).toBe(0);
    run(state, 1);
    expect(state.distance).toBeGreaterThan(distance);
    expect(state.tags.falls).toBe(1);
  });
  it("十分に高く跳んでいれば、障害物の上を越えられる", () => {
    const state = newGame(fixed(0.99));
    state.events = [];
    state.obstacles = [
      { kind: "bag", at: 400, width: 30, height: 40, hit: false },
    ];
    state.distance = 400 - 10; // 障害物が、キャラの体に重なる位置
    state.y = 60;
    stepGame(state, 0.001);
    expect(state.stun).toBe(0);
    expect(state.tags.falls).toBe(0);
  });
});

describe("できごと: お母さん", () => {
  it("家で、お母さんの位置に着くと始まり、走らなくなる。時刻は進む", () => {
    const state = newGame();
    clearObstacles(state);
    const mother = event(state, "mother");
    state.distance = mother.at - 1;
    stepGame(state, 0.05);
    expect(state.active?.kind).toBe("mother");
    expect(mother.phase).toBe("scold");
    const distance = state.distance;
    const before = clockMinute(state);
    run(state, 1);
    expect(state.distance).toBe(distance);
    expect(clockMinute(state)).toBeGreaterThan(before + 0.9);
  });
  it("10 回連打すると解放される。連打しなくても、7 秒で終わる", () => {
    const fast = newGame();
    clearObstacles(fast);
    const m1 = event(fast, "mother");
    fast.distance = m1.at;
    stepGame(fast, 0.05);
    for (let i = 0; i < MOTHER_TAPS; i++) press(fast);
    expect(eventView(fast)?.taps).toBe(MOTHER_TAPS);
    stepGame(fast, 0.05);
    expect(fast.active).toBeNull();
    expect(summarize(fast).notes[0]).toMatch(/お母さんに 1 秒 怒られた/);

    const slow = newGame();
    clearObstacles(slow);
    slow.distance = event(slow, "mother").at;
    stepGame(slow, 0.05);
    run(slow, MOTHER_MAX + 0.5);
    expect(slow.active).toBeNull();
    // 走るのが、再開する
    const distance = slow.distance;
    run(slow, 0.5);
    expect(slow.distance).toBeGreaterThan(distance);
  });
});

describe("できごと: 倒れているおばさん", () => {
  function atObasan() {
    const state = newGame();
    clearObstacles(state);
    state.events = state.events.filter((item) => item.kind === "obasan");
    state.distance = state.events[0].at - 150;
    stepGame(state, 0.05);
    return state;
  }
  it("手前で止まって、助けるか選ぶ。選ぶまで時刻だけが進む", () => {
    const state = atObasan();
    expect(eventView(state)).toMatchObject({ kind: "obasan", phase: "ask" });
    const distance = state.distance;
    run(state, 2);
    expect(state.distance).toBe(distance);
    expect(state.active?.kind).toBe("obasan");
  });
  it("助ける: 8 回連打すると、飴をもらって、しばらく速くなる", () => {
    const state = atObasan();
    choose(state, 0);
    expect(eventView(state)).toMatchObject({
      phase: "help",
      need: OBASAN_TAPS,
    });
    for (let i = 0; i < OBASAN_TAPS; i++) press(state);
    stepGame(state, 0.05);
    expect(state.active).toBeNull();
    expect(state.tags.helped).toBe(true);
    expect(state.boost).toBeGreaterThan(BOOST_SECONDS - 0.5);
    const normal = newGame(fixed(0.99));
    normal.events = [];
    clearObstacles(normal);
    stepGame(normal, 1);
    const before = state.distance;
    stepGame(state, 1);
    expect(state.distance - before).toBeGreaterThan(normal.distance * 1.2);
  });
  it("助ける: 連打が足りなくても 6 秒で終わる (飴はもらえない)", () => {
    const state = atObasan();
    choose(state, 0);
    run(state, 6.5);
    expect(state.active).toBeNull();
    expect(state.tags.helped).toBe(true);
    expect(state.boost).toBe(0);
  });
  it("通り過ぎる: 走り出すが、おばさんの体が道に残る (跳び越える)", () => {
    const state = atObasan();
    choose(state, 1);
    expect(state.active).toBeNull();
    expect(state.tags.ignored).toBe(true);
    const body = state.obstacles.find((item) => item.body);
    expect(body).toBeDefined();
    expect(body!.at).toBe(state.events[0].at);
  });
});

describe("できごと: 踏切", () => {
  function atCrossing() {
    const state = newGame();
    clearObstacles(state);
    state.events = state.events.filter((item) => item.kind === "crossing");
    state.distance = state.events[0].at - 150;
    stepGame(state, 0.05);
    return state;
  }
  it("遮断機が下りて、手前で止まる。待つと 5.5 秒で開く", () => {
    const state = atCrossing();
    expect(eventView(state)).toMatchObject({ kind: "crossing", phase: "ask" });
    choose(state, 0);
    run(state, CROSSING_WAIT - 0.2);
    expect(state.active).not.toBeNull();
    run(state, 0.5);
    expect(state.active).toBeNull();
    expect(state.tags.waited).toBe(true);
  });
  it("渡る: 合図の間にタップすると、すぐ渡れる", () => {
    const state = atCrossing();
    choose(state, 1);
    run(state, DASH_OPEN + 0.1);
    expect(eventView(state)?.signal).toBe(true);
    press(state);
    expect(state.active).toBeNull();
    expect(state.tags.dashed).toBe(true);
  });
  it("渡る: 合図の前にタップすると、電車に阻まれて 4 秒止まる", () => {
    const state = atCrossing();
    choose(state, 1);
    run(state, 0.3);
    press(state);
    expect(eventView(state)?.phase).toBe("blocked");
    expect(state.tags.blocked).toBe(true);
    run(state, BLOCKED_SECONDS - 0.3);
    expect(state.active).not.toBeNull();
    run(state, 0.5);
    expect(state.active).toBeNull();
  });
  it("渡る: 合図を逃しても、電車に阻まれる", () => {
    const state = atCrossing();
    choose(state, 1);
    run(state, DASH_CLOSE + 0.2);
    expect(eventView(state)?.phase).toBe("blocked");
  });
  it("できごとの外では、選択も連打も何も起こさない", () => {
    const state = newGame(fixed(0.99));
    state.events = [];
    choose(state, 0);
    choose(state, 1);
    expect(state.active).toBeNull();
    expect(state.obstacles.some((item) => item.body)).toBe(false);
  });
});

describe("結果", () => {
  it("何をしたかを、ひと言ずつ残す", () => {
    const state = newGame(fixed(0.99));
    state.events = [];
    state.tags.helped = true;
    state.tags.dashed = true;
    state.tags.falls = 2;
    const notes = summarize(state).notes;
    expect(notes).toContain("おばさんを助けた(いい人)");
    expect(notes).toContain("踏切を駆け抜けた!");
    expect(notes).toContain("転んだ 2 回");
  });
});

describe("速さの調整とスタミナ", () => {
  function open() {
    const state = newGame(fixed(0.99));
    state.events = [];
    clearObstacles(state);
    return state;
  }
  function distanceIn(state: GameState, seconds: number) {
    const before = state.distance;
    run(state, seconds);
    return state.distance - before;
  }
  it("ダッシュは速く、ゆっくりは遅い。ふつうとの比は、決めた倍率", () => {
    const normal = distanceIn(open(), 1);
    const dash = open();
    setPace(dash, "dash");
    const slow = open();
    setPace(slow, "slow");
    expect(distanceIn(dash, 1) / normal).toBeCloseTo(DASH_RATE, 1);
    expect(distanceIn(slow, 1) / normal).toBeCloseTo(SLOW_RATE, 1);
  });
  it("ダッシュ中は、1 秒に決めた量だけ、スタミナが減る。ふつうに走ると、戻る", () => {
    const state = open();
    setPace(state, "dash");
    run(state, 1);
    expect(state.stamina).toBeCloseTo(STAMINA_MAX - STAMINA_DRAIN, 0);
    setPace(state, "normal");
    const low = state.stamina;
    run(state, 1);
    expect(state.stamina).toBeGreaterThan(low + 9);
    // 上限を超えない
    run(state, 30);
    expect(state.stamina).toBe(STAMINA_MAX);
  });
  it("ゆっくり歩くと、ふつうより速くスタミナが戻る", () => {
    const a = open();
    a.stamina = 20;
    run(a, 2);
    const b = open();
    b.stamina = 20;
    setPace(b, "slow");
    run(b, 2);
    expect(b.stamina).toBeGreaterThan(a.stamina + 15);
  });
  it("スタミナを使い切ると息切れ: とても遅くなり、ダッシュを押しても速くならない", () => {
    const state = open();
    setPace(state, "dash");
    run(state, STAMINA_MAX / STAMINA_DRAIN + 0.3);
    expect(state.exhausted).toBe(true);
    expect(state.tags.exhausted).toBe(1);
    const normal = distanceIn(open(), 1);
    // ダッシュを押したままでも、息切れの速さ
    expect(distanceIn(state, 1) / normal).toBeLessThan(EXHAUSTED_RATE + 0.1);
    expect(summarize(state).notes).toContain("息切れした 1 回");
  });
  it("息切れは、スタミナが 30 まで戻ると終わる。そのあと、ダッシュできる", () => {
    const state = open();
    setPace(state, "dash");
    run(state, STAMINA_MAX / STAMINA_DRAIN + 0.3);
    expect(state.exhausted).toBe(true);
    setPace(state, "normal");
    let guard = 0;
    while (state.exhausted && guard++ < 400) stepGame(state, 0.05);
    expect(state.exhausted).toBe(false);
    expect(state.stamina).toBeGreaterThanOrEqual(RECOVER_AT);
    setPace(state, "dash");
    const normal = distanceIn(open(), 1);
    expect(distanceIn(state, 1) / normal).toBeGreaterThan(DASH_RATE - 0.1);
  });
  it("転んでいる間とできごとの最中は、ダッシュしても減らず、休める", () => {
    const state = open();
    setPace(state, "dash");
    state.stamina = 50;
    state.stun = 2;
    run(state, 1);
    expect(state.stamina).toBeGreaterThan(50);
    const event = newGame();
    clearObstacles(event);
    setPace(event, "dash");
    event.stamina = 50;
    event.distance = event.events[0].at;
    stepGame(event, 0.05);
    expect(event.active).not.toBeNull();
    run(event, 1);
    expect(event.stamina).toBeGreaterThan(50);
  });
  it("おばさんを助けた飴で、スタミナが全回復し、息切れも治る", () => {
    const state = newGame();
    clearObstacles(state);
    state.events = state.events.filter((item) => item.kind === "obasan");
    state.distance = state.events[0].at - 150;
    state.stamina = 0;
    state.exhausted = true;
    stepGame(state, 0.05);
    choose(state, 0);
    for (let i = 0; i < OBASAN_TAPS; i++) press(state);
    stepGame(state, 0.05);
    expect(state.stamina).toBe(STAMINA_MAX);
    expect(state.exhausted).toBe(false);
  });
});

describe("できごと: 犬に追いかけられる", () => {
  function chased() {
    const state = onlyGame("dog");
    state.distance = state.events[0].at;
    stepGame(state, 0.05);
    return state;
  }
  it("犬の位置に着くと、追いかけっこが始まる。走りは止まらない", () => {
    const state = chased();
    expect(state.chase?.kind).toBe("dog");
    expect(state.active).toBeNull();
    expect(eventView(state)).toMatchObject({ kind: "dog", phase: "chase" });
    const distance = state.distance;
    stepGame(state, 0.1);
    expect(state.distance).toBeGreaterThan(distance);
  });
  it("ふつうの速さのままだと、追いつかれて転ぶ(犬は去る)", () => {
    const state = chased();
    run(state, DOG_SECONDS);
    expect(state.chase).toBeNull();
    expect(state.tags.bitten).toBe(true);
    expect(state.tags.falls).toBe(0); // 犬に転ばされた (障害物ではない)
    expect(summarize(state).notes).toContain("犬に追いつかれた…");
  });
  it("ダッシュで走り続けると、逃げ切れる", () => {
    const state = chased();
    setPace(state, "dash");
    run(state, DOG_SECONDS + 0.3);
    expect(state.chase).toBeNull();
    expect(state.tags.dogEscaped).toBe(true);
    expect(state.tags.bitten).toBe(false);
  });
  it("息切れすると、追いつかれる。距離の割合が、表示に出る", () => {
    const state = chased();
    state.stamina = 5;
    setPace(state, "dash");
    expect(eventView(state)?.progress).toBeCloseTo(1, 1);
    run(state, 1.5);
    expect(state.exhausted).toBe(true);
    run(state, DOG_SECONDS);
    expect(state.tags.bitten).toBe(true);
    expect(DOG_START_GAP).toBeGreaterThan(0);
  });
  it("ほかのできごとが始まると、犬はあきらめて去る (転ばない)", () => {
    // 犬は範囲の始め (2000)、自販機は真ん中 (6050) に置く
    const values = [0, 0.5];
    let call = 0;
    const state = createGame(() => values[Math.min(call++, 1)], {
      kinds: ["dog", "vending"],
      conditions: TODAY,
    });
    clearObstacles(state);
    startGame(state);
    const [dog, vending] = state.events;
    expect(dog.kind).toBe("dog");
    state.distance = dog.at;
    stepGame(state, 0.05);
    expect(state.chase).not.toBeNull();
    state.distance = vending.at - 150;
    stepGame(state, 0.05);
    expect(state.chase).toBeNull();
    expect(state.tags.bitten).toBe(false);
    expect(state.active?.kind).toBe("vending");
  });
});

describe("できごと: 自販機", () => {
  function atVending() {
    const state = onlyGame("vending");
    state.distance = state.events[0].at - 150;
    stepGame(state, 0.05);
    return state;
  }
  it("寄ると 2 秒かかって、スタミナが全回復し、息切れも治る", () => {
    const state = atVending();
    state.stamina = 0;
    state.exhausted = true;
    expect(eventView(state)).toMatchObject({ kind: "vending", phase: "ask" });
    choose(state, 0);
    run(state, VENDING_SECONDS - 0.3);
    expect(state.active).not.toBeNull();
    run(state, 0.5);
    expect(state.active).toBeNull();
    expect(state.stamina).toBe(STAMINA_MAX);
    expect(state.exhausted).toBe(false);
    expect(state.tags.drank).toBe(true);
  });
  it("通り過ぎると、何も起きない", () => {
    const state = atVending();
    state.stamina = 10;
    choose(state, 1);
    expect(state.active).toBeNull();
    expect(state.tags.drank).toBe(false);
  });
});

describe("できごと: 友達に話しかけられる", () => {
  function atFriend() {
    const state = onlyGame("friend");
    state.distance = state.events[0].at - 150;
    stepGame(state, 0.05);
    return state;
  }
  it("立ち話をすると 3 秒かかって、おにぎりでスタミナが戻る", () => {
    const state = atFriend();
    state.stamina = 10;
    choose(state, 0);
    run(state, FRIEND_SECONDS + 0.2);
    expect(state.active).toBeNull();
    // 立ち話の間にも、少し戻る (ふつうの回復)
    expect(state.stamina).toBeGreaterThanOrEqual(10 + FRIEND_STAMINA);
    expect(state.stamina).toBeLessThan(10 + FRIEND_STAMINA + 40);
    expect(state.tags.chatted).toBe(true);
  });
  it("急いでいると言うと、すぐ走り出せる", () => {
    const state = atFriend();
    choose(state, 1);
    expect(state.active).toBeNull();
    expect(state.tags.chatted).toBe(false);
  });
  it("息切れ中に、おにぎりで 30 以上に戻れば、息切れが治る", () => {
    const state = atFriend();
    state.stamina = 0;
    state.exhausted = true;
    choose(state, 0);
    run(state, FRIEND_SECONDS + 0.2);
    expect(state.exhausted).toBe(false);
  });
});

describe("できごと: 走ってくる自転車 (動く障害物)", () => {
  /** 自転車が走り出す手前から始める。jumpAtDx: 自転車がこの近さ (px) になったら跳ぶ (null なら、跳ばない)。 */
  function ride(jumpAtDx: number | null): GameState {
    const state = onlyGame("bike");
    state.distance = state.events[0].at - BIKE_LEAD - 1;
    let jumped = false;
    for (let i = 0; i < 1500; i++) {
      const bike = state.obstacles.find((item) => item.kind === "bike");
      if (
        jumpAtDx !== null &&
        bike !== undefined &&
        !jumped &&
        bike.at - state.distance < jumpAtDx
      ) {
        jump(state);
        jumped = true;
      }
      stepGame(state, 1 / 120);
      if (bike && (bike.hit || bike.passed)) break;
    }
    return state;
  }

  it("近づくまでは、待っている。近づくと、走り出す (止まらずに走り続け、文字や合図は出ない)", () => {
    const state = onlyGame("bike");
    const bike = state.events[0];
    state.distance = bike.at - BIKE_LEAD - 60;
    run(state, 0.1);
    expect(bike.phase).toBe("idle");
    expect(state.obstacles.some((item) => item.kind === "bike")).toBe(false);
    state.distance = bike.at - BIKE_LEAD - 1;
    stepGame(state, 0.05);
    expect(bike.phase).toBe("ride");
    expect(state.active).toBeNull();
    expect(eventView(state)).toBeNull();
    const rider = state.obstacles.find((item) => item.kind === "bike");
    expect(rider).toMatchObject({ speed: BIKE_SPEED, hit: false });
    const before = state.distance;
    run(state, 0.2);
    expect(state.distance).toBeGreaterThan(before); // 走りは、止まらない
  });
  it("走ってくる: こちらが止まっていても、左へ動く", () => {
    const state = onlyGame("bike");
    state.distance = state.events[0].at - BIKE_LEAD - 1;
    stepGame(state, 0.05);
    const rider = state.obstacles.find((item) => item.kind === "bike")!;
    state.stun = 5;
    const at = rider.at;
    const t0 = state.time;
    run(state, 0.5);
    expect(rider.at).toBeCloseTo(at - BIKE_SPEED * (state.time - t0), 0);
  });
  it("ちょうどよいときに跳べば、よけられる。ぶつからず、転ばない", () => {
    const state = ride(170);
    expect(state.tags.bikeDodged).toBe(true);
    expect(state.tags.bikeHit).toBe(false);
    expect(state.tags.falls).toBe(0);
    expect(state.stun).toBe(0);
    expect(state.events[0].phase).toBe("done");
    expect(summarize(state).notes).toContain("自転車をよけた!");
  });
  it("跳ばなければ、ぶつかって転ぶ", () => {
    const state = ride(null);
    expect(state.tags.bikeHit).toBe(true);
    expect(state.tags.bikeDodged).toBe(false);
    expect(state.tags.falls).toBe(1);
    expect(state.stun).toBeGreaterThan(0);
    expect(summarize(state).notes).toContain("自転車にぶつかって転んだ");
  });
  it("跳ぶのが早すぎても、遅すぎても、ぶつかる (タイミングを見て、跳ぶ)", () => {
    expect(ride(520).tags.bikeHit).toBe(true); // 早すぎる: 着地してから、来る
    expect(ride(30).tags.bikeHit).toBe(true); // 遅すぎる: 跳ぶ前に、ぶつかる
    // 跳べる幅: 0.05〜0.6 秒ほど前に跳べば、よけられる (近さで、およそ 45〜320 px)
    for (const dx of [60, 120, 200, 280]) {
      expect(ride(dx).tags.bikeDodged, String(dx)).toBe(true);
    }
  });
  it("自転車は、ふつうの障害物には混ざらない (できごとのときだけ、走ってくる)", () => {
    for (let seed = 0; seed < 200; seed++) {
      let a = seed + 1;
      const rand = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const state = createGame(rand, { kinds: [], conditions: TODAY });
      expect(state.obstacles.some((item) => item.kind === "bike")).toBe(false);
    }
  });
});

describe("できごと: 校門で先生に呼び止められる", () => {
  function atTeacher() {
    const state = onlyGame("teacher");
    state.distance = state.events[0].at - 150;
    stepGame(state, 0.05);
    return state;
  }
  it("あいさつを 8 回連打すると、抜けられる。しなくても 5 秒で終わる", () => {
    const fast = atTeacher();
    expect(eventView(fast)).toMatchObject({
      kind: "teacher",
      need: TEACHER_TAPS,
    });
    for (let i = 0; i < TEACHER_TAPS; i++) press(fast);
    stepGame(fast, 0.05);
    expect(fast.active).toBeNull();
    expect(fast.tags.greeted).toBe(true);

    const slow = atTeacher();
    run(slow, TEACHER_MAX + 0.3);
    expect(slow.active).toBeNull();
  });
  it("教室の手前 (校門の前) で起きる", () => {
    const state = createGame(fixed(0.5), {
      kinds: ["teacher"],
      conditions: TODAY,
    });
    expect(state.events[0].at).toBeGreaterThan(11000);
    expect(state.events[0].at).toBeLessThan(11800);
  });
});

describe("今日の条件 (起きた時刻・天気・道のり・障害物)", () => {
  // 偏りの少ない乱数 (mulberry32)
  function seeded(seed: number) {
    let a = seed + 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  it("起きた時刻から、時刻が進む。早起きは余裕があり、寝坊は厳しい", () => {
    const early = createGame(fixed(0.5), {
      kinds: ["dog"],
      conditions: { ...TODAY, wake: 7 * 60 + 50 },
    });
    startGame(early);
    expect(clockMinute(early)).toBe(7 * 60 + 50);
    expect(clockText(clockMinute(early))).toBe("7:50");
    const late = createGame(fixed(0.5), {
      kinds: ["dog"],
      conditions: { ...TODAY, wake: 8 * 60 + 10 },
    });
    startGame(late);
    late.events = [];
    clearObstacles(late);
    // 起きてから 70 分たった (まだ着いていない): 8:10 起床なら 9:20 で遅刻
    late.time = 70;
    stepGame(late, 0.05);
    expect(late.status).toBe("late");
    const early2 = createGame(fixed(0.5), {
      kinds: ["dog"],
      conditions: { ...TODAY, wake: 7 * 60 + 50 },
    });
    startGame(early2);
    early2.events = [];
    clearObstacles(early2);
    // 7:50 起床なら、同じ 70 分でも 9:00。まだ間に合う
    early2.time = 70;
    stepGame(early2, 0.05);
    expect(early2.status).toBe("playing");
  });
  it("雨の日は、転ぶと 3 秒止まる。ほかの日は 2 秒", () => {
    const rain = createGame(fixed(0.5), {
      kinds: ["dog"],
      conditions: { ...TODAY, weather: "rain" },
    });
    expect(stunSeconds(rain)).toBe(RAIN_STUN_SECONDS);
    expect(stunSeconds(newGame())).toBe(STUN_SECONDS);
    startGame(rain);
    rain.events = [];
    rain.obstacles = [
      { kind: "bag", at: 400, width: 30, height: 40, hit: false },
    ];
    rain.distance = 390;
    stepGame(rain, 0.016);
    expect(rain.stun).toBe(RAIN_STUN_SECONDS);
  });
  it("条件は、毎回ランダム。道のりは範囲に収まり、3 種類の天気が出る。起きた時刻は、8:00 から", () => {
    const weathers = new Set<string>();
    for (let seed = 0; seed < 400; seed++) {
      const state = createGame(seeded(seed));
      weathers.add(state.weather);
      expect(state.startMinute).toBe(START_MINUTE);
      expect(state.routeLength).toBeGreaterThanOrEqual(ROUTE_LENGTH * 0.95 - 1);
      expect(state.routeLength).toBeLessThanOrEqual(ROUTE_LENGTH * 1.05 + 1);
    }
    expect([...weathers].sort()).toEqual(["cloudy", "rain", "sunny"]);
  });
  it("前回と同じ天気は、出にくい", () => {
    const sunny = (previous: { weather?: string }) => {
      let count = 0;
      for (let seed = 0; seed < 2000; seed++) {
        if (createGame(seeded(seed), { previous }).weather === "sunny") {
          count += 1;
        }
      }
      return count;
    };
    const plain = sunny({});
    const after = sunny({ weather: "sunny" });
    expect(after).toBeLessThan(plain * 0.75);
    expect(after).toBeGreaterThan(0);
  });
  it("障害物の種類: 水たまりは雨の日だけ。猫は雨の日に出ない。どれも、大きさは範囲の中", () => {
    const kindsIn = (weather: Weather) => {
      const kinds = new Set<string>();
      for (let seed = 0; seed < 60; seed++) {
        const state = createGame(seeded(seed), {
          conditions: { weather, wake: START_MINUTE },
        });
        for (const item of state.obstacles) {
          kinds.add(item.kind);
          if (item.kind === "puddle") expect(item.height).toBeLessThan(10);
          if (item.kind === "bag") expect(item.height).toBeGreaterThan(20);
        }
      }
      return [...kinds].sort();
    };
    expect(kindsIn("sunny")).toEqual(["bag", "bin", "cat"]);
    expect(kindsIn("cloudy")).toEqual(["bag", "bin", "cat"]);
    expect(kindsIn("rain")).toEqual(["bag", "bin", "puddle"]);
  });
  it("水たまりは、少し跳べば越えられる。ごみ箱・猫は、ふつうに跳べば越えられる", () => {
    const state = newGame(fixed(0.99));
    state.events = [];
    state.obstacles = [
      { kind: "puddle", at: 400, width: 40, height: 6, hit: false },
    ];
    state.distance = 390;
    state.y = 3;
    stepGame(state, 0.001);
    expect(state.stun).toBe(0);
  });
  it("できごとの見た目・せりふの違い (0〜2) が、決まる", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const item of createGame(seeded(seed)).events) {
        expect([0, 1, 2]).toContain(item.variant);
      }
    }
    const state = createGame(fixed(0.5), { kinds: ["mother"] });
    expect(state.events[0].variant).toBe(1);
  });
  it("道のりが違っても、着く判定は、その日の長さで行う", () => {
    const state = createGame(fixed(0.5), {
      kinds: [],
      conditions: { ...TODAY, routeLength: ROUTE_LENGTH - 700 },
    });
    startGame(state);
    clearObstacles(state);
    state.distance = ROUTE_LENGTH - 705;
    stepGame(state, 1);
    expect(state.status).toBe("arrived");
    expect(state.distance).toBe(ROUTE_LENGTH - 700);
  });
});

describe("起床チャレンジ (目覚ましのバー)", () => {
  // 偏りの少ない乱数 (mulberry32)
  function seeded(seed: number) {
    let a = seed + 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function waking(seed = 1): GameState {
    const state = createGame(seeded(seed), { conditions: TODAY });
    startWake(state);
    return state;
  }
  /** そのゾーンの区間の、真ん中の位置 (なければ null)。 */
  function midOf(state: GameState, zone: WakeZone, nth = 0): number | null {
    const found = state.wake.segments.filter((item) => item.zone === zone);
    const segment = found[nth];
    return segment ? (segment.from + segment.to) / 2 : null;
  }
  /** バーが、狙った位置に来るまで進めて、止める。 */
  function stopAt(state: GameState, pos: number) {
    let guard = 0;
    while (Math.abs(state.wake.pos - pos) > 0.004 && guard++ < 20000) {
      stepGame(state, 0.005);
    }
    pressKey(state);
  }

  it("起きられる時刻は、いちばん良くて 8:00。ゾーンが悪いほど、遅い", () => {
    const wakes = WAKE_ZONES.map((item) => item.wake);
    expect(wakes[0]).toBe(8 * 60);
    expect([...wakes].sort((a, b) => a - b)).toEqual(wakes);
    expect(WAKE_OPTIONS).toEqual(wakes);
    expect(WAKE_OPTIONS.every((minute) => minute >= 8 * 60)).toBe(true);
  });
  it("バーは 16 マス。良いマスは 9 つ、赤 (二度寝) が 7 つ。同じゾーンが並ぶと、まとまる", () => {
    const segments = buildWakeSegments(seeded(5));
    // 隙間なく、0〜1 をおおう
    expect(segments[0].from).toBe(0);
    expect(segments[segments.length - 1].to).toBe(1);
    for (let k = 1; k < segments.length; k++) {
      expect(segments[k].from).toBeCloseTo(segments[k - 1].to, 10);
      expect(segments[k].zone).not.toBe(segments[k - 1].zone);
    }
    const cells = (zone: WakeZone) =>
      segments
        .filter((item) => item.zone === zone)
        .reduce((sum, item) => sum + (item.to - item.from) * WAKE_CELLS, 0);
    for (const item of WAKE_ZONES) {
      expect(Math.round(cells(item.zone)), item.zone).toBe(item.cells);
    }
    expect(Math.round(cells("miss"))).toBe(7);
  });
  it("色の並びは、毎回ランダム。真ん中が良いとは限らず、赤が途中にも入る", () => {
    const layouts = new Set<string>();
    const middle = new Set<string>();
    let redInside = 0;
    for (let seed = 0; seed < 200; seed++) {
      const segments = buildWakeSegments(seeded(seed));
      layouts.add(JSON.stringify(segments));
      middle.add(wakeZoneAt(0.5, segments).zone);
      // 端 (両側 3 マス) より内側に、赤がある
      if (
        segments.some(
          (item) =>
            item.zone === "miss" &&
            item.from >= 3 / WAKE_CELLS &&
            item.to <= 13 / WAKE_CELLS,
        )
      ) {
        redInside += 1;
      }
    }
    expect(layouts.size).toBeGreaterThan(150);
    expect(middle.size).toBeGreaterThanOrEqual(4);
    expect(middle.has("miss")).toBe(true);
    expect(redInside).toBeGreaterThan(190);
  });
  it("位置から、そのマスのゾーンが決まる。端の位置 (0 と 1) も、決まる", () => {
    const segments = [
      { from: 0, to: 0.5, zone: "miss" as const },
      { from: 0.5, to: 0.75, zone: "perfect" as const },
      { from: 0.75, to: 1, zone: "late" as const },
    ];
    expect(wakeZoneAt(0, segments).zone).toBe("miss");
    expect(wakeZoneAt(0.49, segments).zone).toBe("miss");
    expect(wakeZoneAt(0.5, segments)).toMatchObject({
      zone: "perfect",
      wake: 8 * 60,
    });
    expect(wakeZoneAt(0.8, segments).wake).toBe(8 * 60 + 15);
    expect(wakeZoneAt(1, segments).zone).toBe("late");
    expect(wakeZoneAt(0.2, segments).wake).toBeNull();
  });
  it("始めると、バーが往復する。速さと始まりの位置は、毎回少し違う", () => {
    const speeds = new Set<number>();
    const starts = new Set<number>();
    for (let seed = 0; seed < 100; seed++) {
      const state = waking(seed);
      expect(state.wake.speed).toBeGreaterThanOrEqual(0.7);
      expect(state.wake.speed).toBeLessThanOrEqual(1.0);
      expect(state.wake.pos).toBeGreaterThanOrEqual(0);
      expect(state.wake.pos).toBeLessThanOrEqual(1);
      speeds.add(state.wake.speed);
      starts.add(Math.round(state.wake.pos * 20));
    }
    expect(speeds.size).toBeGreaterThan(50);
    expect(starts.size).toBeGreaterThan(10);
    // 往復して、折り返す
    const state = waking(3);
    let max = 0;
    let min = 1;
    let turned = 0;
    let direction = 0;
    for (let i = 0; i < 700; i++) {
      const before = state.wake.pos;
      stepGame(state, 0.01);
      max = Math.max(max, state.wake.pos);
      min = Math.min(min, state.wake.pos);
      const now = Math.sign(state.wake.pos - before);
      if (now !== 0 && direction !== 0 && now !== direction) turned += 1;
      if (now !== 0) direction = now;
      expect(state.wake.pos).toBeGreaterThanOrEqual(0);
      expect(state.wake.pos).toBeLessThanOrEqual(1);
    }
    expect(max).toBeGreaterThan(0.95);
    expect(min).toBeLessThan(0.05);
    expect(turned).toBeGreaterThanOrEqual(2);
  });
  it("バーが動いている間は、走らない (時刻も進まない)", () => {
    const state = waking();
    stepGame(state, 1);
    expect(state.distance).toBe(0);
    expect(state.time).toBe(0);
  });
  it("金のマスで止めると 8:00 起床 (いちばん良い)。そのまま、走り出せる", () => {
    const state = waking(4);
    stopAt(state, midOf(state, "perfect")!);
    expect(state.wake.zone).toBe("perfect");
    expect(wakeView(state)).toMatchObject({ stopped: true, clock: "8:00" });
    // 結果を見せている間は、まだ起きない
    stepGame(state, WAKE_PAUSE - 0.3);
    expect(state.status).toBe("waking");
    stepGame(state, 0.5);
    expect(state.status).toBe("playing");
    expect(state.startMinute).toBe(8 * 60);
    expect(clockText(clockMinute(state))).toBe("8:00");
    expect(summarize(state).notes[0]).toBe("8:00 起床 (ベストな目覚め!)");
  });
  it("ゾーンごとに、起きた時刻が決まる", () => {
    for (const item of WAKE_ZONES) {
      const state = waking(9);
      stopAt(state, midOf(state, item.zone)!);
      expect(state.wake.zone, item.zone).toBe(item.zone);
      stepGame(state, WAKE_PAUSE + 0.1);
      expect(state.status).toBe("playing");
      expect(state.startMinute).toBe(item.wake);
    }
  });
  it("赤いマス (二度寝) で止めると、即遅刻。真ん中の赤でも同じ (走らずに終わる)", () => {
    // 真ん中が赤になる並びを探す
    let state: GameState | null = null;
    for (let seed = 0; seed < 200 && state === null; seed++) {
      const candidate = waking(seed);
      // 境目の近くで止まっても、赤になるように、両どなりも赤の並びを選ぶ
      if (
        [0.49, 0.5, 0.51].every(
          (pos) => wakeZoneAt(pos, candidate.wake.segments).zone === "miss",
        )
      ) {
        state = candidate;
      }
    }
    expect(state).not.toBeNull();
    stopAt(state!, 0.5);
    expect(state!.wake.zone).toBe("miss");
    expect(wakeView(state!)).toMatchObject({ clock: null, label: "二度寝!!" });
    stepGame(state!, WAKE_PAUSE + 0.1);
    expect(state!.status).toBe("late");
    expect(state!.slept).toBe(true);
    const summary = summarize(state!);
    expect(summary).toMatchObject({
      outcome: "late",
      arrival: "9:15",
      margin: 0,
    });
    expect(summary.remaining).toBeGreaterThan(1000);
    expect(summary.notes).toEqual(["二度寝してしまった…"]);
  });
  it("止めずに 8 秒たつと、二度寝", () => {
    const state = waking();
    run(state, WAKE_TIME_LIMIT - 0.3, 0.05);
    expect(state.status).toBe("waking");
    expect(state.wake.stopped).toBe(false);
    run(state, 0.5, 0.05);
    expect(state.wake.zone).toBe("miss");
    run(state, WAKE_PAUSE + 0.2, 0.05);
    expect(state.status).toBe("late");
    expect(state.slept).toBe(true);
  });
  it("止めたあとの、もう一度のタップは、何も変えない", () => {
    const state = waking(4);
    stopAt(state, midOf(state, "good")!);
    const zone = state.wake.zone;
    const pos = state.wake.pos;
    pressKey(state);
    pressKey(state);
    stepGame(state, 0.05);
    expect(state.wake.zone).toBe(zone);
    expect(state.wake.pos).toBe(pos);
  });
  it("寝坊 (8:15 以降) の日は、雨はくもりに、水たまりはごみ箱に。できごとは 2 つまで", () => {
    const state = createGame(fixed(0.5), {
      kinds: ["mother", "dog", "crossing"],
      conditions: { ...TODAY, weather: "rain" },
    });
    expect(state.weather).toBe("rain");
    expect(state.events).toHaveLength(3);
    state.obstacles.push({
      kind: "puddle",
      at: 5000,
      width: 40,
      height: 6,
      hit: false,
    });
    applyWake(state, 8 * 60 + 15);
    expect(state.weather).toBe("cloudy");
    expect(state.events).toHaveLength(2);
    expect(state.obstacles.some((item) => item.kind === "puddle")).toBe(false);
    expect(stunSeconds(state)).toBe(STUN_SECONDS);
  });
  it("寝坊でない日 (8:10 まで) は、雨も、できごとも、そのまま", () => {
    const state = createGame(fixed(0.5), {
      kinds: ["mother", "dog", "crossing"],
      conditions: { ...TODAY, weather: "rain" },
    });
    applyWake(state, 8 * 60 + 10);
    expect(state.weather).toBe("rain");
    expect(state.events).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- 難易度と、校舎の階段

describe("難易度 (かんたん / ふつう / むずかしい)", () => {
  function seeded2(seed: number) {
    let a = seed + 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const reds = (difficulty: Difficulty) => {
    const segments = buildWakeSegments(seeded2(3), difficulty);
    return segments
      .filter((item) => item.zone === "miss")
      .reduce((sum, item) => sum + (item.to - item.from) * WAKE_CELLS, 0);
  };

  it("3 つの難易度。階段があるのは、むずかしいだけ", () => {
    expect(DIFFICULTY_IDS).toEqual(["easy", "normal", "hard"]);
    expect(isDifficulty("hard")).toBe(true);
    expect(isDifficulty("extreme")).toBe(false);
    expect(isDifficulty(null)).toBe(false);
    expect(createGame(seeded2(1), { difficulty: "easy" }).stairs).toBeNull();
    expect(createGame(seeded2(1)).stairs).toBeNull();
    expect(createGame(seeded2(1)).difficulty).toBe("normal");
    const hard = createGame(seeded2(1), { difficulty: "hard" });
    expect(hard.difficulty).toBe("hard");
    expect(hard.stairs?.flights).toBe(5);
    expect(hard.stairs?.plan).toHaveLength(5);
    expect(hard.stairs?.on).toBe(false);
  });
  it("起床バーの赤 (二度寝) は、かんたん 5 マス、ふつう 7 マス、むずかしい 9 マス", () => {
    expect(Math.round(reds("easy"))).toBe(5);
    expect(Math.round(reds("normal"))).toBe(7);
    expect(Math.round(reds("hard"))).toBe(9);
    // 色のマスは、どの難易度でも、金・緑・黄緑・オレンジ・濃いオレンジがそろう
    for (const id of DIFFICULTY_IDS) {
      const zones = new Set(
        buildWakeSegments(seeded2(9), id).map((item) => item.zone),
      );
      for (const item of WAKE_ZONES)
        expect(zones.has(item.zone), id).toBe(true);
    }
  });
  it("バーの速さは、難しいほど速い", () => {
    const speeds = (difficulty: Difficulty) => {
      const list: number[] = [];
      for (let seed = 0; seed < 200; seed++) {
        list.push(createGame(seeded2(seed), { difficulty }).wake.speed);
      }
      return [Math.min(...list), Math.max(...list)];
    };
    const [easyMin, easyMax] = speeds("easy");
    const [normalMin, normalMax] = speeds("normal");
    const [hardMin, hardMax] = speeds("hard");
    expect(easyMin).toBeGreaterThanOrEqual(0.55);
    expect(easyMax).toBeLessThan(normalMax);
    expect(normalMin).toBeGreaterThanOrEqual(0.7);
    expect(hardMin).toBeGreaterThanOrEqual(0.9);
    expect(hardMax).toBeGreaterThan(normalMax);
  });
  it("できごとの数: かんたん 1〜2、ふつう 1〜3、むずかしい 3〜4", () => {
    const counts = (difficulty: Difficulty) => {
      const found = new Set<number>();
      for (let seed = 0; seed < 300; seed++) {
        found.add(createGame(seeded2(seed), { difficulty }).events.length);
      }
      return [...found].sort();
    };
    expect(counts("easy")).toEqual([1, 2]);
    expect(counts("normal")).toEqual([1, 2, 3]);
    const hard = counts("hard");
    expect(Math.min(...hard)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...hard)).toBe(4);
  });
  it("道のりと、できごとの場所は、難易度に合わせて縮む。場面の切れ目も", () => {
    const hard = createGame(seeded2(4), { difficulty: "hard" });
    expect(hard.routeLength).toBeLessThanOrEqual(
      ROUTE_LENGTH * 0.75 * 1.05 + 1,
    );
    expect(hard.routeLength).toBeGreaterThanOrEqual(
      ROUTE_LENGTH * 0.75 * 0.95 - 1,
    );
    const easy = createGame(seeded2(4), { difficulty: "easy" });
    expect(easy.routeLength).toBeLessThan(ROUTE_LENGTH * 0.9 * 1.05 + 1);
    for (let seed = 0; seed < 100; seed++) {
      const state = createGame(seeded2(seed), { difficulty: "hard" });
      for (const item of state.events) {
        const slot = EVENT_SLOTS[item.kind];
        expect(item.at).toBeGreaterThanOrEqual(slot.from * 0.75 - 1e-6);
        expect(item.at).toBeLessThanOrEqual(slot.to * 0.75 + 1e-6);
        // どのできごとも、道のりの中に入る
        expect(item.at).toBeLessThan(state.routeLength);
      }
    }
    expect(stageAt(11800 * 0.75 - 1, 0.75)).toBe("street");
    expect(stageAt(11800 * 0.75, 0.75)).toBe("school");
    expect(stageAt(1500 * 0.75, 0.75)).toBe("street");
    // 指定しなければ、これまでと同じ
    expect(stageAt(11800)).toBe("school");
  });
  it("ダッシュで減るスタミナは、かんたんは少なく、むずかしいは多い", () => {
    const used = (difficulty: Difficulty) => {
      const state = createGame(fixed(0), {
        kinds: [],
        conditions: TODAY,
        difficulty,
      });
      clearObstacles(state);
      startGame(state);
      setPace(state, "dash");
      run(state, 1);
      return STAMINA_MAX - state.stamina;
    };
    expect(used("easy")).toBeCloseTo(STAMINA_DRAIN * 0.7, 0);
    expect(used("normal")).toBeCloseTo(STAMINA_DRAIN, 0);
    expect(used("hard")).toBeCloseTo(STAMINA_DRAIN * 1.3, 0);
  });
  it("寝坊の日のできごとの上限: むずかしいは 3 つまで (ふつうは 2 つ)", () => {
    const hard = createGame(fixed(0), {
      kinds: ["mother", "dog", "crossing", "teacher"],
      conditions: TODAY,
      difficulty: "hard",
    });
    expect(hard.events).toHaveLength(4);
    applyWake(hard, 8 * 60 + 15);
    expect(hard.events).toHaveLength(3);
    const normal = createGame(fixed(0), {
      kinds: ["mother", "dog", "crossing"],
      conditions: TODAY,
    });
    applyWake(normal, 8 * 60 + 15);
    expect(normal.events).toHaveLength(2);
  });
});

describe("校舎の階段 (むずかしい)", () => {
  function seeded3(seed: number) {
    let a = seed + 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** 階段に入った直後のゲーム。plan で決めた階段だけ、できごとが起きる (null は、なし)。 */
  function onStairs(
    plan: ("walker" | "teacher" | "friend" | null)[] = [],
  ): GameState {
    const state = createGame(fixed(0), {
      kinds: [],
      conditions: TODAY,
      difficulty: "hard",
    });
    clearObstacles(state);
    startGame(state);
    state.distance = state.routeLength - 5;
    stepGame(state, 0.05);
    state.stairs!.plan.forEach((item, index) => {
      const kind = plan[index] ?? null;
      if (kind === null) item.phase = "done";
      else item.kind = kind;
    });
    return state;
  }
  const other = (state: GameState) =>
    state.stairs!.last === "left" ? "right" : "left";
  /** 左右を交互に押して、count 段上る (1 回ごとに少し時間が進む)。 */
  function climbSteps(state: GameState, count: number, dt = 0.2) {
    for (let k = 0; k < count; k++) {
      climb(state, other(state));
      stepGame(state, dt);
    }
  }

  it("道のりが終わると、すぐには着かず、階段が始まる (時刻は、続く)", () => {
    const state = onStairs();
    expect(state.status).toBe("playing");
    expect(state.stairs?.on).toBe(true);
    expect(state.stairs?.steps).toBe(0);
    expect(stairsView(state)).toMatchObject({
      floor: 1,
      intro: true,
      kind: null,
    });
    const before = clockMinute(state);
    run(state, 1);
    expect(clockMinute(state)).toBeCloseTo(before + 1, 1);
    expect(state.status).toBe("playing");
  });
  it("階段のない難易度は、道のりが終わると、そのまま着く", () => {
    const state = createGame(fixed(0), { kinds: [], conditions: TODAY });
    clearObstacles(state);
    startGame(state);
    state.distance = state.routeLength - 5;
    stepGame(state, 0.05);
    expect(state.status).toBe("arrived");
    expect(stairsView(state)).toBeNull();
    // 階段の操作は、何も起こさない
    climb(state, "left");
    expect(state.stun).toBe(0);
  });
  it("左右を交互に押すと、1 段ずつ上る。同じ側を続けると、つまずいて止まる", () => {
    const state = onStairs();
    climb(state, "left");
    expect(state.stairs?.steps).toBe(1);
    climb(state, "right");
    expect(state.stairs?.steps).toBe(2);
    climb(state, "right"); // 続けて同じ側
    expect(state.stairs?.steps).toBe(2);
    expect(state.stun).toBe(STAIR_STUMBLE);
    expect(state.tags.stumbles).toBe(1);
    // つまずいている間は、上れない
    climb(state, "left");
    expect(state.stairs?.steps).toBe(2);
    run(state, STAIR_STUMBLE + 0.1);
    expect(state.stun).toBe(0);
    // 立ち直ったあとは、どちらの側からでも始められる
    climb(state, "right");
    expect(state.stairs?.steps).toBe(3);
  });
  it("12 段で 1 つ上の階。6 階まで (60 段) 上ると、着く", () => {
    const state = onStairs();
    expect(floorOf(state.stairs!)).toBe(1);
    climbSteps(state, STAIR_STEPS);
    expect(floorOf(state.stairs!)).toBe(2);
    climbSteps(state, STAIR_STEPS * 3);
    expect(floorOf(state.stairs!)).toBe(5);
    expect(state.status).toBe("playing");
    climbSteps(state, STAIR_STEPS);
    expect(state.status).toBe("arrived");
    expect(floorOf(state.stairs!)).toBe(TOP_FLOOR);
    const summary = summarize(state);
    expect(summary.outcome).toBe("arrived");
    expect(summary.stairsFloor).toBe(TOP_FLOOR);
    // 着いたあとは、押しても動かない
    climb(state, "left");
    expect(state.stairs?.steps).toBe(STAIR_STEPS * 5);
  });
  it("階段でも跳べる。跳んでいる間は、足を出せない。先生や友達のできごとの最中は、跳べない", () => {
    const state = onStairs();
    jump(state);
    expect(state.vy).toBeGreaterThan(0);
    stepGame(state, 0.05);
    expect(state.y).toBeGreaterThan(0);
    const steps = state.stairs!.steps;
    climb(state, other(state));
    expect(state.stairs!.steps).toBe(steps); // 空中では、上れない
    run(state, 1);
    expect(state.y).toBe(0);
    climb(state, other(state));
    expect(state.stairs!.steps).toBe(steps + 1);

    const talking = onStairs(["teacher"]);
    climbSteps(talking, STAIR_EVENT_STEP);
    expect(talking.stairs?.event?.kind).toBe("teacher");
    jump(talking);
    expect(talking.vy).toBe(0);
  });

  /**
   * 降りてくる人が近づくまで、交互に上る (1 秒に 5 段)。近づいたら上るのをやめて待ち、すれ違うまで見る。
   * jumpGap: 人との近さ (段) がこれより近くなったら跳ぶ (null なら、跳ばない)。
   */
  function meetWalker(state: GameState, jumpGap: number | null) {
    const walker = state.stairs!.plan[0];
    let sinceClimb = 1;
    let jumped = false;
    for (let i = 0; i < 3000 && walker.phase !== "done"; i++) {
      const gap = walker.pos - (state.stairs!.steps + state.stairs!.partial);
      if (
        jumpGap !== null &&
        !jumped &&
        walker.phase === "walk" &&
        gap < jumpGap
      ) {
        jump(state);
        jumped = true;
      }
      sinceClimb += 0.02;
      // 人が近づいたら (3 段より近く)、上るのをやめて、見て待つ (1 段ずつしか進めないので、近づく速さが飛ぶ)
      if (sinceClimb >= 0.2 && (walker.phase !== "walk" || gap > 3)) {
        climb(state, other(state));
        sinceClimb = 0;
      }
      stepGame(state, 0.02);
    }
  }

  it("降りてくる人: 階段の上で待っていて、その階段に入ると、おりてくる。上る足は、止まらない", () => {
    const state = onStairs(["walker"]);
    const walker = state.stairs!.plan[0];
    expect(walker.phase).toBe("idle");
    expect(stairsView(state)).toMatchObject({ kind: null }); // 文は、出ない
    // 階段に入っただけでは、まだ待っている。WALKER_START_STEP 段上ると、おりてくる
    climbSteps(state, WALKER_START_STEP);
    expect(walker.phase).toBe("walk");
    expect(walker.pos).toBe(STAIR_STEPS); // 階段の上の踊り場から
    const steps = state.stairs!.steps;
    climb(state, other(state));
    expect(state.stairs!.steps).toBe(steps + 1); // 上れる (止まらない)
    expect(stairsView(state)).toMatchObject({ kind: null });
    // おりてくる人は、時間とともに、下の段へ
    const pos = walker.pos;
    run(state, 0.5);
    expect(walker.pos).toBeCloseTo(pos - WALKER_SPEED * 0.5, 0);
  });
  it("降りてくる人: ちょうどよいときに跳べば、よけられる。ぶつからず、転ばない", () => {
    const state = onStairs(["walker"]);
    meetWalker(state, 1);
    expect(state.stairs!.plan[0].phase).toBe("done");
    expect(state.tags.stairDodged).toBe(1);
    expect(state.tags.stairHit).toBe(0);
    expect(state.stun).toBe(0);
  });
  it("降りてくる人: 跳ばなければ、ぶつかって転ぶ (1 回だけ数える)", () => {
    const state = onStairs(["walker"]);
    meetWalker(state, null);
    expect(state.tags.stairHit).toBe(1);
    expect(state.tags.stairDodged).toBe(0);
    expect(summarize(state).notes).toContain("階段で人とぶつかった");
  });
  it("降りてくる人: 跳ぶのが早すぎても、遅すぎても、ぶつかる", () => {
    const early = onStairs(["walker"]);
    meetWalker(early, 11);
    expect(early.tags.stairHit).toBe(1);
    const late = onStairs(["walker"]);
    meetWalker(late, 0);
    expect(late.tags.stairHit).toBe(1);
    for (const gap of [0.4, 1, 1.6]) {
      const state = onStairs(["walker"]);
      meetWalker(state, gap);
      expect(state.tags.stairDodged, String(gap)).toBe(1);
    }
  });
  it("先生に止められる: 動かずに待てば済む。動くと怒られて、止まる", () => {
    const wait = onStairs(["teacher"]);
    climbSteps(wait, STAIR_EVENT_STEP);
    expect(stairsView(wait)).toMatchObject({ kind: "teacher", phase: "stop" });
    run(wait, STAIR_TEACHER_STOP + 0.1);
    expect(wait.stairs?.event).toBeNull();
    expect(wait.tags.stairScolded).toBe(0);
    const before = wait.stairs!.steps;
    climb(wait, other(wait)); // また動ける
    expect(wait.stairs!.steps).toBe(before + 1);

    const move = onStairs(["teacher"]);
    climbSteps(move, STAIR_EVENT_STEP);
    expect(move.stairs?.event?.kind).toBe("teacher");
    climb(move, other(move));
    expect(move.stairs?.event).toBeNull();
    expect(move.tags.stairScolded).toBe(1);
    expect(move.stun).toBe(STAIR_SCOLD_STUN);
  });
  it("友達: 立ち話をするとスタミナが戻る。急ぐと言えば、そのまま", () => {
    const talk = onStairs(["friend"]);
    climbSteps(talk, STAIR_EVENT_STEP);
    expect(stairsView(talk)).toMatchObject({ kind: "friend", phase: "ask" });
    talk.stamina = 10;
    choose(talk, 0);
    expect(talk.stairs?.event?.phase).toBe("talk");
    run(talk, STAIR_FRIEND_SECONDS + 0.1);
    expect(talk.stairs?.event).toBeNull();
    expect(talk.tags.stairChatted).toBe(true);
    expect(talk.stamina).toBeGreaterThanOrEqual(10 + FRIEND_STAMINA);

    const rush = onStairs(["friend"]);
    climbSteps(rush, STAIR_EVENT_STEP);
    choose(rush, 1);
    expect(rush.stairs?.event).toBeNull();
    expect(rush.tags.stairChatted).toBe(false);
  });
  it("階段ごとに、できごとが 1 つ。同じ種類は、続かない", () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const state = createGame(seeded3(seed), { difficulty: "hard" });
      const plan = state.stairs!.plan;
      expect(plan).toHaveLength(5);
      for (let k = 1; k < plan.length; k++) {
        expect(plan[k].kind).not.toBe(plan[k - 1].kind);
      }
      plan.forEach((item) => kinds.add(item.kind));
    }
    expect([...kinds].sort()).toEqual(["friend", "teacher", "walker"]);
  });
  it("連打しすぎると、スタミナが切れて、息切れ: 1 段上るのに、何度も押す", () => {
    const state = onStairs();
    // 休まずに、押し続ける
    let guard = 0;
    while (!state.exhausted && guard++ < 200) climb(state, other(state));
    expect(state.exhausted).toBe(true);
    expect(state.tags.exhausted).toBe(1);
    const before = state.stairs!.steps;
    // 息切れ中は、2〜3 回押して、やっと 1 段
    for (let k = 0; k < 5; k++) climb(state, other(state));
    expect(state.stairs!.steps - before).toBe(2);
    // 休むと、戻る
    run(state, 10);
    expect(state.exhausted).toBe(false);
    expect(state.stamina).toBeGreaterThanOrEqual(RECOVER_AT);
  });
  it("階段で 9:15 になったら遅刻。何階だったかが、結果に出る", () => {
    const state = onStairs();
    climbSteps(state, STAIR_STEPS * 2 + 3);
    state.time = DEADLINE_MINUTE - state.startMinute - 0.01;
    run(state, 0.1);
    expect(state.status).toBe("late");
    const summary = summarize(state);
    expect(summary.outcome).toBe("late");
    expect(summary.stairsFloor).toBe(3);
    expect(summary.remaining).toBe(0);
    expect(summary.arrival).toBe("9:15");
  });
  it("階段のできごとと、つまずきは、結果の一言に出る", () => {
    const state = onStairs(["walker", "teacher"]);
    meetWalker(state, 1); // 1 つめの階段: 人を、跳んでよける
    // 2 つめの階段: 先生の前まで上って、動いてしまう
    while (state.stairs!.steps < STAIR_STEPS + STAIR_EVENT_STEP) {
      climb(state, other(state));
      stepGame(state, 0.2);
    }
    expect(state.stairs?.event?.kind).toBe("teacher");
    climb(state, other(state));
    run(state, 3);
    expect(summarize(state).notes).toContain("階段で人をよけた");
    expect(summarize(state).notes).toContain("階段で先生に怒られた");
    expect(
      summarize(state).notes.some((note) =>
        note.startsWith("階段でつまずいた"),
      ),
    ).toBe(false);
    climb(state, "left");
    climb(state, "left");
    expect(summarize(state).notes).toContain("階段でつまずいた 1 回");
  });
});

// ---------------------------------------------------------------- 点数とタイムアタック

describe("モードと、その日のコース", () => {
  it("日付は日本時間で決まる (UTC の 15:00 に、次の日になる)", () => {
    expect(jstDayKey(new Date("2026-11-17T14:59:59Z"))).toBe("2026-11-17");
    expect(jstDayKey(new Date("2026-11-17T15:00:00Z"))).toBe("2026-11-18");
    expect(jstDayKey(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(jstDayKey(new Date("2026-02-28T15:00:00Z"))).toBe("2026-03-01");
  });
  it("コースの種は、日付と難易度で決まる。同じなら、いつも同じ", () => {
    expect(courseSeed("2026-11-17", "hard")).toBe(
      courseSeed("2026-11-17", "hard"),
    );
    expect(courseSeed("2026-11-17", "hard")).not.toBe(
      courseSeed("2026-11-17", "easy"),
    );
    expect(courseSeed("2026-11-17", "hard")).not.toBe(
      courseSeed("2026-11-18", "hard"),
    );
    const a = seededRandom(123);
    const b = seededRandom(123);
    for (let k = 0; k < 20; k++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
  it("同じ日・同じ難易度なら、天気・できごと・障害物・階段が、まったく同じコース", () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const make = () =>
        createGame(seededRandom(courseSeed("2026-11-17", difficulty)), {
          difficulty,
          mode: "timeattack",
        });
      const first = make();
      const second = make();
      expect(first.weather).toBe(second.weather);
      expect(first.routeLength).toBe(second.routeLength);
      expect(first.events).toEqual(second.events);
      expect(first.obstacles).toEqual(second.obstacles);
      expect(first.stairs?.plan).toEqual(second.stairs?.plan);
    }
    // 日が変わると、コースが変わる
    const days = new Set<string>();
    for (let day = 1; day <= 20; day++) {
      const state = createGame(
        seededRandom(
          courseSeed(`2026-11-${String(day).padStart(2, "0")}`, "normal"),
        ),
      );
      days.add(
        JSON.stringify(state.events.map((item) => item.kind)) +
          state.routeLength,
      );
    }
    expect(days.size).toBeGreaterThan(10);
  });
  it("モードは、決めなければ通常", () => {
    expect(createGame(seededRandom(1)).mode).toBe("normal");
    expect(createGame(seededRandom(1), { mode: "timeattack" }).mode).toBe(
      "timeattack",
    );
    expect(isMode("timeattack")).toBe(true);
    expect(isMode("x")).toBe(false);
    expect(MODE_IDS).toEqual(["normal", "timeattack"]);
  });
  it("タイムアタック: 9:15 になっても遅刻にならず、着くまで続く。起きた時刻は 8:00", () => {
    const state = createGame(fixed(0), {
      kinds: [],
      conditions: TODAY,
      mode: "timeattack",
    });
    clearObstacles(state);
    startGame(state);
    expect(state.startMinute).toBe(8 * 60);
    setPace(state, "slow");
    run(state, 90);
    expect(clockMinute(state)).toBeGreaterThan(DEADLINE_MINUTE);
    expect(state.status).toBe("playing");
    state.distance = state.routeLength - 5;
    run(state, 1);
    expect(state.status).toBe("arrived");
    const summary = summarize(state);
    expect(summary.outcome).toBe("arrived");
    expect(summary.mode).toBe("timeattack");
    expect(summary.score).toBe(0);
    expect(summary.grade).toBeNull();
    expect(summary.breakdown).toEqual([]);
    expect(summary.elapsed).toBeGreaterThan(90);
  });
  it("タイムアタック: 階段でも、9:15 で遅刻にならない", () => {
    const state = createGame(fixed(0), {
      kinds: [],
      conditions: TODAY,
      difficulty: "hard",
      mode: "timeattack",
    });
    clearObstacles(state);
    startGame(state);
    state.distance = state.routeLength - 5;
    stepGame(state, 0.05);
    expect(state.stairs?.on).toBe(true);
    state.stairs!.plan.forEach((item) => (item.phase = "done"));
    state.time = 100;
    run(state, 1);
    expect(state.status).toBe("playing");
  });
  it("通常モードは、これまでどおり 9:15 で遅刻", () => {
    const state = createGame(fixed(0), { kinds: [], conditions: TODAY });
    clearObstacles(state);
    startGame(state);
    setPace(state, "slow");
    run(state, 80);
    expect(state.status).toBe("late");
  });
});

describe("点数 (通常モード)", () => {
  /** 着いたゲーム。margin (余裕の分) は、時刻を合わせて作る。 */
  function arrivedWith(
    margin: number,
    difficulty: Difficulty = "normal",
  ): GameState {
    const state = createGame(fixed(0), {
      kinds: [],
      conditions: TODAY,
      difficulty,
    });
    clearObstacles(state);
    startGame(state);
    state.distance = state.routeLength - 1;
    state.time = DEADLINE_MINUTE - state.startMinute - margin - 0.5;
    stepGame(state, 0.05);
    state.status = "arrived";
    return state;
  }
  it("点数 = 余裕の分 × 10。いい行いは足され、悪い行いは引かれる", () => {
    const plain = arrivedWith(30);
    expect(summarize(plain).margin).toBe(30);
    expect(summarize(plain).score).toBe(300);
    expect(summarize(plain).breakdown).toEqual([
      { label: "余裕 30 分", points: 300 },
    ]);

    const good = arrivedWith(30);
    Object.assign(good.tags, {
      helped: true,
      greeted: true,
      dogEscaped: true,
      bikeDodged: true,
      stairDodged: 2,
    });
    expect(summarize(good).score).toBe(300 + 50 + 30 + 20 + 20 + 30);

    const bad = arrivedWith(30);
    Object.assign(bad.tags, { ignored: true, stairScolded: 1, falls: 3 });
    expect(summarize(bad).score).toBe(300 - 30 - 20 - 15);
    const labels = summarize(bad).breakdown.map((line) => line.label);
    expect(labels).toContain("おばさんを見て見ぬふり");
    expect(labels).toContain("転んだ ×3");
  });
  it("点数は、マイナスにならない", () => {
    const state = arrivedWith(0);
    Object.assign(state.tags, { ignored: true, falls: 20 });
    expect(summarize(state).score).toBe(0);
  });
  it("評価: 600 点で S、450 で A、300 で B、150 で C、それ未満は D", () => {
    expect(gradeOf(600)).toBe("S");
    expect(gradeOf(599)).toBe("A");
    expect(gradeOf(450)).toBe("A");
    expect(gradeOf(449)).toBe("B");
    expect(gradeOf(300)).toBe("B");
    expect(gradeOf(150)).toBe("C");
    expect(gradeOf(149)).toBe("D");
    expect(gradeOf(0)).toBe("D");
    expect(summarize(arrivedWith(30)).grade).toBe("B");
  });
  it("遅刻と二度寝は、0 点で、評価もない", () => {
    const state = createGame(fixed(0), { kinds: [], conditions: TODAY });
    clearObstacles(state);
    startGame(state);
    setPace(state, "slow");
    run(state, 80);
    const summary = summarize(state);
    expect(summary.outcome).toBe("late");
    expect(summary.score).toBe(0);
    expect(summary.grade).toBeNull();
    expect(summary.breakdown).toEqual([]);
  });
});

describe("階段の人は、突然は現れない", () => {
  it("人が立つ段は、決まっている: 先生と友達はできごとの 3 段先、降りてくる人は、階段の上の踊り場", () => {
    for (let flight = 0; flight < 5; flight++) {
      const start = flight * STAIR_STEPS;
      expect(stairActorStep(flight, "teacher")).toBe(
        start + STAIR_EVENT_STEP + STAIR_ACTOR_AHEAD,
      );
      expect(stairActorStep(flight, "friend")).toBe(
        stairActorStep(flight, "teacher"),
      );
      expect(stairActorStep(flight, "walker")).toBe(start + STAIR_STEPS);
      // できごとが始まる段より、先にいる (上る前から、見えている)
      expect(stairActorStep(flight, "teacher")).toBeGreaterThan(
        start + STAIR_EVENT_STEP,
      );
    }
  });
});
