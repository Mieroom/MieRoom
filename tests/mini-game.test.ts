import { describe, expect, it } from "vitest";
import {
  canPlayMiniGame,
  createGame,
  floorLabel,
  isMiniGamePhrase,
  jump,
  opensMiniGame,
  scoreOf,
  speedAt,
  startGame,
  stepGame,
  WORLD,
} from "@/lib/domain/mini-game";

// ミニゲーム「遅刻ダッシュ」: 合言葉、進み方、ジャンプ、当たり、階の表示。

const fixed = (value: number) => () => value;

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

describe("進み方", () => {
  it("始める前は進まない。始めると、距離が増えて点数になる", () => {
    const game = createGame();
    stepGame(game, 0.5, fixed(0));
    expect(game.distance).toBe(0);
    startGame(game);
    stepGame(game, 1, fixed(0));
    expect(game.distance).toBeGreaterThan(200);
    expect(scoreOf(game)).toBe(Math.floor(game.distance / 12));
  });
  it("速さは、だんだん上がり、上限で止まる", () => {
    expect(speedAt(0)).toBeLessThan(speedAt(100));
    expect(speedAt(100000)).toBe(speedAt(200000));
  });
  it("階は、100 m ごとに上がり、6 階の次は屋上", () => {
    expect(floorLabel(0)).toBe("1階");
    expect(floorLabel(99)).toBe("1階");
    expect(floorLabel(100)).toBe("2階");
    expect(floorLabel(599)).toBe("6階");
    expect(floorLabel(600)).toBe("屋上");
    expect(floorLabel(5000)).toBe("屋上");
  });
});

describe("ジャンプと着地", () => {
  it("地面にいるときだけ跳べる。空中ではもう一度跳べない。着地すると 0 に戻る", () => {
    const game = createGame();
    startGame(game);
    jump(game);
    stepGame(game, 0.1, fixed(0));
    expect(game.y).toBeGreaterThan(0);
    const velocity = game.vy;
    jump(game); // 空中: 何も起きない
    expect(game.vy).toBe(velocity);
    for (let i = 0; i < 100 && game.y > 0; i++) stepGame(game, 0.02, fixed(0));
    expect(game.y).toBe(0);
    expect(game.vy).toBe(0);
  });
  it("始める前や終わったあとは、跳べない", () => {
    const game = createGame();
    jump(game);
    expect(game.vy).toBe(0);
    game.status = "over";
    jump(game);
    expect(game.vy).toBe(0);
  });
});

describe("障害物と当たり", () => {
  it("走り続けると障害物が出る。画面の外に出たものは捨てる", () => {
    const game = createGame();
    startGame(game);
    // 跳んでよける
    let guard = 0;
    while (game.obstacles.length === 0 && guard++ < 2000) {
      stepGame(game, 0.016, fixed(0.5));
    }
    expect(game.obstacles.length).toBeGreaterThan(0);
    expect(game.obstacles[0].x).toBeLessThanOrEqual(WORLD.width + 10);
  });
  it("障害物にぶつかると終わり。終わったあとは進まない", () => {
    const game = createGame();
    startGame(game);
    game.obstacles.push({ x: 80, width: 30, height: 40 });
    stepGame(game, 0.016, fixed(0.5));
    expect(game.status).toBe("over");
    const distance = game.distance;
    stepGame(game, 0.5, fixed(0.5));
    expect(game.distance).toBe(distance);
  });
  it("十分に高く跳んでいれば、障害物の上を越えられる", () => {
    const game = createGame();
    startGame(game);
    game.y = 60;
    game.vy = 0;
    game.obstacles.push({ x: 80, width: 30, height: 40 });
    stepGame(game, 0.001, fixed(0.5));
    expect(game.status).toBe("playing");
  });
  it("速さが上限でも、ジャンプで必ず越えられる間隔で障害物が出る(間隔の下限)", () => {
    // 最高速で 1 つ出した直後の「次まで」が、跳んで着地する距離より長い
    const game = createGame();
    startGame(game);
    game.distance = 560 * 12 * 100; // 上限の速さになる点数
    game.untilNext = 0;
    stepGame(game, 0.001, fixed(0)); // いちばん狭い間隔が選ばれる
    const airDistance = 560 * ((2 * 640) / 1900);
    expect(game.untilNext).toBeGreaterThan(airDistance);
  });
});
