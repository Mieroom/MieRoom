import { describe, expect, it } from "vitest";
import {
  AIR_TIME,
  BIKE_WINDOW,
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
  STUN_SECONDS,
  stepGame,
  summarize,
  TEACHER_MAX,
  TEACHER_TAPS,
  VENDING_SECONDS,
  type EventKind,
  type GameState,
} from "@/lib/domain/mini-game";

// ミニゲーム「遅刻ダッシュ」: 合言葉、時刻、できごと (8 種類)、転ぶ、着く / 遅刻。

const fixed = (value: number) => () => value;
/** rand = 0 のゲーム: お母さん (150)、おばさん (3200)、踏切 (8000) の 3 つが起きる。 */
function newGame(
  rand: () => number = fixed(0),
  kinds: EventKind[] = ["mother", "obasan", "crossing"],
): GameState {
  const state = createGame(rand, { kinds });
  startGame(state);
  return state;
}
/** 種類を決めて、その 1 つだけが起きるゲーム (位置は、起きうる範囲の始め)。 */
function onlyGame(kind: EventKind): GameState {
  const state = createGame(fixed(0), { kinds: [kind] });
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
    const state = createGame(fixed(0.5), { kinds: ["dog", "bike"] });
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

describe("できごと: 自転車の飛び出し", () => {
  function atBike() {
    const state = onlyGame("bike");
    state.distance = state.events[0].at - 150;
    stepGame(state, 0.05);
    return state;
  }
  it("止まって、すぐ合図が出る。タップすると、よけられる", () => {
    const state = atBike();
    expect(eventView(state)).toMatchObject({ kind: "bike", signal: true });
    press(state);
    expect(state.active).toBeNull();
    expect(state.tags.bikeDodged).toBe(true);
    expect(state.stun).toBe(0);
  });
  it("0.8 秒のあいだにタップしないと、転ぶ", () => {
    const state = atBike();
    run(state, BIKE_WINDOW + 0.2);
    expect(state.active).toBeNull();
    expect(state.tags.bikeHit).toBe(true);
    expect(state.stun).toBeGreaterThan(0);
    expect(summarize(state).notes).toContain("自転車にぶつかって転んだ");
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
    const state = createGame(fixed(0.5), { kinds: ["teacher"] });
    expect(state.events[0].at).toBeGreaterThan(11000);
    expect(state.events[0].at).toBeLessThan(11800);
  });
});
