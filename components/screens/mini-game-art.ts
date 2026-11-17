import {
  floorNumber,
  PLAYER,
  WORLD,
  type GameState,
} from "@/lib/domain/mini-game";

// 「遅刻ダッシュ」のドット絵。320×120 の小さな絵に描いて、画面では整数倍に引き伸ばす
// (ぼやけずに、わざと粗く見える)。ゲームの世界の座標 (640×240) の 1/2 が、絵の 1 ドット。
// 色は、数を絞った決まった色だけを使う。

export const ART = { width: 320, height: 120 } as const;
const GROUND = WORLD.groundY / 2; // 床の高さ (ドット)
const CEILING = 14;

const C = {
  ceiling: "#2b3558",
  hud: "#ffffff",
  wallTop: "#aab4d4",
  wall: "#c4cce4",
  wallShade: "#b3bcd9",
  baseboard: "#8d98bd",
  lamp: "#fff4b8",
  floor: "#5d6a96",
  floorAlt: "#6b78a6",
  floorLine: "#4a5680",
  dust: "#9aa5cc",
  window: "#9fd4f2",
  windowLight: "#d6f0ff",
  frame: "#f0f2fa",
  door: "#7a5a3c",
  doorDark: "#5e4329",
  doorLight: "#926f4b",
  plate: "#f0e6c8",
  locker: "#6f8fc4",
  lockerDark: "#546f9c",
  lockerLight: "#8eabda",
  ink: "#1f2a44",
  brand: "#d7263d",
  brandLight: "#ff7b8a",
  brandDark: "#9e1429",
  white: "#ffffff",
  bag: "#a0652f",
  bagLight: "#c98a50",
  bagDark: "#6b3f18",
  gold: "#f2c94c",
} as const;

function rect(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** 一定の間隔 (period) で並ぶものを、視差 (factor) をつけて流しながら描く。 */
function tiles(
  distance: number,
  factor: number,
  period: number,
  draw: (x: number, index: number) => void,
) {
  const shift = distance * factor;
  for (
    let i = Math.floor(shift / period);
    i * period - shift < ART.width;
    i++
  ) {
    draw(Math.round(i * period - shift), i);
  }
}

// ---------------------------------------------------------------- 3×5 の字

const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  M: ["101", "111", "111", "101", "101"],
  F: ["111", "100", "110", "100", "100"],
  R: ["110", "101", "110", "101", "101"],
  O: ["111", "101", "101", "101", "111"],
  " ": ["000", "000", "000", "000", "000"],
};

function textWidth(text: string, scale: number): number {
  return text.length === 0 ? 0 : (text.length * 4 - 1) * scale;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
) {
  ctx.fillStyle = color;
  let cursor = x;
  for (const char of text) {
    const glyph = GLYPHS[char] ?? GLYPHS[" "];
    glyph.forEach((row, rowIndex) => {
      for (let col = 0; col < 3; col++) {
        if (row[col] === "1") {
          ctx.fillRect(
            cursor + col * scale,
            y + rowIndex * scale,
            scale,
            scale,
          );
        }
      }
    });
    cursor += 4 * scale;
  }
}

// ---------------------------------------------------------------- 背景

function drawWindow(ctx: CanvasRenderingContext2D, x: number) {
  rect(ctx, C.frame, x, 24, 26, 22);
  rect(ctx, C.window, x + 2, 26, 22, 18);
  rect(ctx, C.windowLight, x + 3, 27, 4, 1);
  rect(ctx, C.windowLight, x + 3, 28, 1, 3);
  rect(ctx, C.frame, x + 12, 26, 2, 18);
  rect(ctx, C.frame, x + 2, 34, 22, 2);
}

function drawDoor(ctx: CanvasRenderingContext2D, x: number, room: number) {
  const top = GROUND - 40;
  rect(ctx, C.plate, x + 1, top - 9, 14, 7);
  drawText(ctx, String(room), x + 2, top - 8, C.ink);
  rect(ctx, C.doorDark, x, top, 16, 40);
  rect(ctx, C.door, x + 1, top + 1, 14, 38);
  rect(ctx, C.doorLight, x + 1, top + 1, 1, 38);
  rect(ctx, C.doorDark, x + 3, top + 4, 10, 14); // 上の板
  rect(ctx, C.doorDark, x + 3, top + 22, 10, 14); // 下の板
  rect(ctx, C.window, x + 4, top + 5, 8, 6); // 小窓
  rect(ctx, C.gold, x + 12, top + 20, 2, 2); // 取っ手
}

function drawLockers(ctx: CanvasRenderingContext2D, x: number) {
  for (let k = 0; k < 4; k++) {
    const left = x + k * 10;
    rect(ctx, C.lockerDark, left, GROUND - 36, 10, 36);
    rect(ctx, C.locker, left + 1, GROUND - 35, 8, 34);
    rect(ctx, C.lockerLight, left + 1, GROUND - 35, 1, 34);
    rect(ctx, C.lockerDark, left + 2, GROUND - 31, 6, 1); // 通気口
    rect(ctx, C.lockerDark, left + 2, GROUND - 29, 6, 1);
    rect(ctx, C.white, left + 7, GROUND - 18, 1, 3); // 取っ手
  }
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  distance: number,
  floor: number,
) {
  // 壁
  rect(ctx, C.wall, 0, CEILING, ART.width, GROUND - CEILING);
  rect(ctx, C.wallTop, 0, CEILING, ART.width, 3);
  // 天井の照明 (近くの景色と同じ流れ)
  tiles(distance, 0.8, 80, (x) => {
    rect(ctx, C.lamp, x + 22, CEILING + 1, 30, 1);
  });
  // 遠く: 窓
  tiles(distance, 0.3, 72, (x) => drawWindow(ctx, x + 12));
  // 近く: 教室のドアと、ロッカー
  tiles(distance, 0.6, 112, (x, index) => {
    if (index % 2 === 0) {
      const room = floor * 100 + (Math.floor(index / 2) % 9) + 1;
      drawDoor(ctx, x + 30, room);
    } else {
      drawLockers(ctx, x + 22);
    }
  });
  // 幅木
  rect(ctx, C.wallShade, 0, GROUND - 6, ART.width, 6);
  rect(ctx, C.baseboard, 0, GROUND - 7, ART.width, 1);
  // 床: 流れるタイル
  rect(ctx, C.floor, 0, GROUND, ART.width, ART.height - GROUND);
  tiles(distance, 1, 32, (x, index) => {
    if (index % 2 === 0)
      rect(ctx, C.floorAlt, x, GROUND, 32, ART.height - GROUND);
    rect(ctx, C.floorLine, x, GROUND, 1, ART.height - GROUND);
  });
  rect(ctx, C.floorLine, 0, GROUND, ART.width, 1);
  rect(ctx, C.floorLine, 0, GROUND + 9, ART.width, 1);
}

// ---------------------------------------------------------------- 障害物 (バッグ)

function drawBag(
  ctx: CanvasRenderingContext2D,
  worldX: number,
  worldWidth: number,
  worldHeight: number,
) {
  const x = Math.round(worldX / 2);
  const w = Math.max(6, Math.round(worldWidth / 2));
  const h = Math.max(8, Math.round(worldHeight / 2));
  const top = GROUND - h;
  const mid = Math.floor(w / 2);
  rect(ctx, C.bag, x, top, w, h);
  rect(ctx, C.bagLight, x + 1, top + 1, w - 2, 1);
  rect(ctx, C.bagLight, x + 1, top + 1, 1, h - 3);
  rect(ctx, C.bagDark, x + w - 1, top + 1, 1, h - 1);
  rect(ctx, C.bagDark, x, GROUND - 1, w, 1);
  rect(ctx, C.bagDark, x + 2, top + Math.floor(h / 2), w - 4, 1); // ポケット
  rect(ctx, C.gold, x + mid - 1, top + Math.floor(h / 2) - 3, 2, 2); // 留め金
  rect(ctx, C.ink, x + mid - 2, top - 2, 4, 1); // 持ち手
  rect(ctx, C.ink, x + mid - 2, top - 1, 1, 1);
  rect(ctx, C.ink, x + mid + 1, top - 1, 1, 1);
}

// ---------------------------------------------------------------- キャラ (13×19 の枠。体 14 行 + 足 5 行)

export type Character = {
  id: string;
  name: string;
  /** 体の絵 (14 行)。'.' は透明。文字は palette の色 */
  sprite: string[];
  palette: Record<string, string>;
  /** 枠の左から、体の絵を置く位置 */
  offsetX: number;
  /** 腕を付ける行 (null: 腕なし)。腕は細い線 */
  armRow: number | null;
  /** 左足・右足の、枠の中の位置 */
  legs: [number, number];
  /** 時計だけ: 針が回る */
  clock?: boolean;
};

export const CHARACTERS: Character[] = [
  {
    id: "pin",
    name: "ピン",
    sprite: [
      "...BBBBBBB...",
      "..BLLBBBBBB..",
      ".BLLBBBBBBBB.",
      ".BLBBBBBBBBB.",
      ".BBBBWWWBBBB.",
      ".BBBBWKWBBBB.",
      ".BBBBWWWBBBD.",
      ".BBBBBBBBBBD.",
      ".BBBBBBBBBDD.",
      "..BBBBBBBBD..",
      "..BBBBBBBDD..",
      "...BBBBBDD...",
      "....BBBDD....",
      ".....BDD.....",
    ],
    palette: {
      B: C.brand,
      L: C.brandLight,
      D: C.brandDark,
      W: C.white,
      K: C.ink,
    },
    offsetX: 0,
    armRow: null,
    legs: [3, 8],
  },
  {
    id: "pencil",
    name: "えんぴつ",
    sprite: [
      ".PPPPPPP.",
      "PPPPPPPPP",
      "GGGGGGGGG",
      "ggggggggg",
      "YYYYYYYYy",
      "YYKYYYKYy",
      "YYKYYYKYy",
      "YYYYYYYYy",
      "YYYKKKYYy",
      "YYYYYYYYy",
      "WWWWWWWWW",
      ".WWWWWWW.",
      "..WWWWW..",
      "...KKK...",
    ],
    palette: {
      P: "#f29aa8",
      G: "#cfd3dc",
      g: "#9aa0ae",
      Y: "#f7c948",
      y: "#d9a62b",
      W: "#e8c99b",
      K: C.ink,
    },
    offsetX: 2,
    armRow: 6,
    legs: [4, 7],
  },
  {
    id: "eraser",
    name: "消しゴム",
    sprite: [
      ".........",
      ".........",
      ".........",
      ".WWWWWWW.",
      "WWWWWWWWw",
      "WWKWWWKWw",
      "WWKWWWKWw",
      "WWWWWWWWw",
      "WWWKKKWWw",
      "BBBBBBBBB",
      "BBBBBBBBB",
      "BBBBBBBBb",
      "BBBBBBBBb",
      "bbbbbbbbb",
    ],
    palette: {
      W: "#f4f6fb",
      w: "#d4d9e6",
      K: C.ink,
      B: "#4f7fd6",
      b: "#3a62ad",
    },
    offsetX: 2,
    armRow: 7,
    legs: [4, 7],
  },
  {
    id: "clock",
    name: "時計",
    sprite: [
      ".........",
      ".........",
      "..RRRRR..",
      ".RRFFFRR.",
      "RRFFFFFRR",
      "RFFKFKFFR",
      "RFFKFKFFR",
      "RFFFFFFFR",
      "RFFFFFFFR",
      "RFFFFFFFR",
      "RFFKKKFFR",
      "RRFFFFFRR",
      ".RRFFFRR.",
      "..RRRRR..",
    ],
    palette: { R: "#2f9e8f", F: "#fff7e0", K: C.ink },
    offsetX: 2,
    armRow: 8,
    legs: [4, 7],
    clock: true,
  },
  {
    id: "notebook",
    name: "ノート",
    sprite: [
      ".........",
      ".........",
      "KNNNNNNNn",
      "GNNNNNNNn",
      "KNLLLLLNn",
      "GNLKLKLNn",
      "KNLLLLLNn",
      "GNLKKKLNn",
      "KNNNNNNNn",
      "GNNNNNNNn",
      "KNNNNNNNn",
      "GNNNNNNNn",
      "KNNNNNNNn",
      "Gnnnnnnnn",
    ],
    palette: {
      K: C.ink,
      G: "#cfd3dc",
      N: "#3aa05a",
      n: "#2a7a43",
      L: "#fffbe8",
    },
    offsetX: 2,
    armRow: 8,
    legs: [4, 7],
  },
];

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  character: Character,
) {
  const left = Math.round(PLAYER.x / 2);
  const feet = GROUND - Math.round(game.y / 2);
  const bodyTop = feet - 19;
  const x0 = left + character.offsetX;
  character.sprite.forEach((row, rowIndex) => {
    for (let col = 0; col < row.length; col++) {
      const color = character.palette[row[col]];
      if (color) rect(ctx, color, x0 + col, bodyTop + rowIndex, 1, 1);
    }
  });
  const frame = Math.floor(game.time * 10) % 2;
  const air = game.y > 0;
  // 時計の針: 4 方向に、順に回る
  if (character.clock) {
    const turn = Math.floor(game.time * 8) % 4;
    const [dx, dy] = [
      [0, -2],
      [2, 0],
      [0, 2],
      [-2, 0],
    ][turn];
    rect(ctx, C.ink, x0 + 4, bodyTop + 8, 1, 1);
    rect(ctx, C.ink, x0 + 4 + dx, bodyTop + 8 + dy, 1, 1);
  }
  // 腕: 細い線。走る間は交互に振り、跳んでいる間は、両方を上げる
  if (character.armRow !== null) {
    const top = bodyTop + character.armRow;
    const leftArm = air ? -3 : frame === 0 ? -2 : 1;
    const rightArm = air ? -3 : frame === 0 ? 1 : -2;
    rect(ctx, C.ink, left + 1, top + leftArm, 1, 4);
    rect(ctx, C.ink, left + 11, top + rightArm, 1, 4);
  }
  // 足: 走っている間は交互に動く。跳んでいる間は、そろえる
  const a = air ? 3 : frame === 0 ? 5 : 3;
  const b = air ? 3 : frame === 0 ? 3 : 5;
  const [legL, legR] = character.legs;
  rect(ctx, C.ink, left + legL, feet - a, 2, a);
  rect(ctx, C.ink, left + legL - 1, feet - 1, 3, 1);
  rect(ctx, C.ink, left + legR, feet - b, 2, b);
  rect(ctx, C.ink, left + legR, feet - 1, 3, 1);
  // 走る土ぼこり
  if (!air && game.status === "playing") {
    const puff = Math.floor(game.time * 18) % 3;
    rect(ctx, C.dust, left - 2 - puff * 2, GROUND - 2, 1, 1);
    rect(ctx, C.dust, left - 5 - puff * 2, GROUND - 1, 1, 1);
  }
}

// ---------------------------------------------------------------- 1 コマ

export function drawScene(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  score: number,
  best: number,
  character: Character = CHARACTERS[0],
) {
  const floor = floorNumber(score);
  ctx.clearRect(0, 0, ART.width, ART.height);
  drawBackground(ctx, game.distance / 2, Math.min(floor, 6));
  for (const obstacle of game.obstacles) {
    drawBag(ctx, obstacle.x, obstacle.width, obstacle.height);
  }
  drawPlayer(ctx, game, character);
  // 上の帯: 階・距離・ベスト (点は m)
  rect(ctx, C.ceiling, 0, 0, ART.width, CEILING);
  const floorText = floor >= 7 ? "ROOF" : `${floor}F`;
  drawText(ctx, `${floorText} ${score}M`, 6, 2, C.hud, 2);
  const bestText = `HI ${best}M`;
  drawText(ctx, bestText, ART.width - 6 - textWidth(bestText, 2), 2, C.hud, 2);
}
