import { describe, expect, it } from "vitest";
import {
  AIR_TIME,
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
  STUN_SECONDS,
  stepGame,
  summarize,
  type GameState,
} from "@/lib/domain/mini-game";

// ミニゲーム「遅刻ダッシュ」: 合言葉、時刻、できごと (お母さん・おばさん・踏切)、転ぶ、着く / 遅刻。

const fixed = (value: number) => () => value;
/** rand = 0 のゲーム: できごと 3 つがすべて起きる (お母さん 150、おばさん 3200、踏切 8000)。 */
function newGame(rand: () => number = fixed(0)): GameState {
  const state = createGame(rand);
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
function event<K extends "mother" | "obasan" | "crossing">(
  state: GameState,
  kind: K,
) {
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
  it("できごとは 1〜3 つ。種類は重ならない。位置は、それぞれの場面の中", () => {
    for (let seed = 0; seed < 200; seed++) {
      let n = seed + 1;
      const rand = () => {
        n = (n * 16807) % 2147483647;
        return n / 2147483647;
      };
      const state = createGame(rand);
      expect(state.events.length).toBeGreaterThanOrEqual(1);
      expect(state.events.length).toBeLessThanOrEqual(3);
      expect(new Set(state.events.map((item) => item.kind)).size).toBe(
        state.events.length,
      );
      for (const item of state.events) {
        if (item.kind === "mother") expect(item.at).toBeLessThan(1500);
        if (item.kind === "obasan") {
          expect(item.at).toBeGreaterThanOrEqual(3200);
          expect(item.at).toBeLessThanOrEqual(6600);
        }
        if (item.kind === "crossing") {
          expect(item.at).toBeGreaterThanOrEqual(8000);
          expect(item.at).toBeLessThanOrEqual(10400);
        }
      }
    }
  });
  it("できごとが 1 つも起きない乱数でも、必ず 1 つは起きる", () => {
    expect(createGame(fixed(0.99)).events).toHaveLength(1);
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
    const state = createGame(fixed(0.99));
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
    state.obstacles = [{ at: 400, width: 30, height: 40, hit: false }];
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
    state.obstacles = [{ at: 400, width: 30, height: 40, hit: false }];
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
