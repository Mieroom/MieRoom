import {
  clockMinute,
  clockText,
  CROSSING_WAIT,
  DEADLINE_MINUTE,
  DIFFICULTIES,
  floorOf,
  stairActorStep,
  STAIR_STEPS,
  STAIR_TEACHER_STOP,
  TOP_FLOOR,
  WAKE_ALARM_MINUTE,
  PLAYER,
  STAGE_STARTS,
  STAMINA_MAX,
  WORLD,
  type GameEvent,
  type GameState,
  type Obstacle,
  type Weather,
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
  cream: "#f3e3c9",
  creamLine: "#ead6b6",
  wood: "#b98a5a",
  woodLine: "#9e7347",
  woodBase: "#c9a679",
  sky: "#bfe3ff",
  skyLight: "#d6efff",
  cloud: "#ffffff",
  asphalt: "#6a7080",
  sidewalk: "#b9bfcc",
  skin: "#f0c7a0",
  alert: "#ff7b8a",
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
  ":": ["000", "010", "000", "010", "000"],
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

// ---------------------------------------------------------------- 小さな絵 (文字で描く)

function sprite(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  palette: Record<string, string>,
  x: number,
  y: number,
) {
  rows.forEach((row, rowIndex) => {
    for (let col = 0; col < row.length; col++) {
      const color = palette[row[col]];
      if (color) rect(ctx, color, x + col, y + rowIndex, 1, 1);
    }
  });
}

/** 世界の道のりの位置を、画面の横位置 (ドット) にする。キャラの足元が、道のりの距離。 */
function screenX(at: number, distance: number): number {
  return Math.round((PLAYER.x + at - distance) / 2);
}

// ---------------------------------------------------------------- 背景: 校舎 (廊下)

function drawWindow(ctx: CanvasRenderingContext2D, x: number) {
  rect(ctx, C.frame, x, 24, 26, 22);
  rect(ctx, C.window, x + 2, 26, 22, 18);
  rect(ctx, C.windowLight, x + 3, 27, 4, 1);
  rect(ctx, C.windowLight, x + 3, 28, 1, 3);
  rect(ctx, C.frame, x + 12, 26, 2, 18);
  rect(ctx, C.frame, x + 2, 34, 22, 2);
}

function drawDoor(
  ctx: CanvasRenderingContext2D,
  x: number,
  room: number | string,
  top = GROUND - 40,
) {
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

function drawSchoolBg(ctx: CanvasRenderingContext2D, distance: number) {
  rect(ctx, C.wall, 0, CEILING, ART.width, GROUND - CEILING);
  rect(ctx, C.wallTop, 0, CEILING, ART.width, 3);
  tiles(distance, 0.8, 80, (x) => {
    rect(ctx, C.lamp, x + 22, CEILING + 1, 30, 1);
  });
  tiles(distance, 0.3, 72, (x) => drawWindow(ctx, x + 12));
  tiles(distance, 0.6, 112, (x, index) => {
    if (index % 2 === 0) {
      drawDoor(ctx, x + 30, 200 + ((Math.floor(index / 2) % 9) + 1));
    } else {
      drawLockers(ctx, x + 22);
    }
  });
  rect(ctx, C.wallShade, 0, GROUND - 6, ART.width, 6);
  rect(ctx, C.baseboard, 0, GROUND - 7, ART.width, 1);
  rect(ctx, C.floor, 0, GROUND, ART.width, ART.height - GROUND);
  tiles(distance, 1, 32, (x, index) => {
    if (index % 2 === 0)
      rect(ctx, C.floorAlt, x, GROUND, 32, ART.height - GROUND);
    rect(ctx, C.floorLine, x, GROUND, 1, ART.height - GROUND);
  });
  rect(ctx, C.floorLine, 0, GROUND, ART.width, 1);
  rect(ctx, C.floorLine, 0, GROUND + 9, ART.width, 1);
}

// ---------------------------------------------------------------- 背景: 家の中

const SKY: Record<Weather, { sky: string; light: string; cloud: string }> = {
  sunny: { sky: "#bfe3ff", light: "#d6efff", cloud: "#ffffff" },
  cloudy: { sky: "#c4ccd9", light: "#d8dde7", cloud: "#eef1f6" },
  rain: { sky: "#8f9bb0", light: "#a9b4c6", cloud: "#7d8799" },
};

function drawHomeBg(
  ctx: CanvasRenderingContext2D,
  distance: number,
  weather: Weather,
) {
  rect(ctx, C.cream, 0, CEILING, ART.width, GROUND - CEILING);
  tiles(distance, 0.6, 16, (x) => rect(ctx, C.creamLine, x, CEILING, 2, 84));
  // 朝の光が入る窓 (カーテンつき)
  tiles(distance, 0.6, 130, (x) => {
    rect(ctx, C.frame, x + 30, 22, 34, 32);
    rect(ctx, SKY[weather].sky, x + 32, 24, 30, 28);
    if (weather === "sunny") rect(ctx, C.gold, x + 52, 26, 8, 8); // 朝日
    if (weather === "rain") {
      for (let k = 0; k < 4; k++)
        rect(ctx, "#dfe9f7", x + 36 + k * 6, 28 + k * 3, 1, 3);
    }
    rect(ctx, C.frame, x + 46, 24, 2, 28);
    rect(ctx, "#e58aa0", x + 27, 20, 7, 36);
    rect(ctx, "#e58aa0", x + 60, 20, 7, 36);
  });
  // 壁の絵
  tiles(distance, 0.6, 130, (x) => {
    rect(ctx, C.woodLine, x + 96, 26, 16, 20);
    rect(ctx, "#d9905a", x + 98, 28, 12, 16);
    rect(ctx, "#6fb06a", x + 98, 38, 12, 6);
  });
  rect(ctx, C.woodBase, 0, GROUND - 5, ART.width, 5);
  rect(ctx, C.woodLine, 0, GROUND - 6, ART.width, 1);
  // ふとん (起きたところ)
  const bed = screenX(-20, distance);
  rect(ctx, C.woodLine, bed, GROUND - 14, 38, 14);
  rect(ctx, C.white, bed + 1, GROUND - 18, 36, 6);
  rect(ctx, "#6fa8e6", bed + 12, GROUND - 17, 24, 5);
  rect(ctx, "#cfe0f6", bed + 2, GROUND - 19, 9, 4);
  // 床 (板張り)
  rect(ctx, C.wood, 0, GROUND, ART.width, ART.height - GROUND);
  tiles(distance, 1, 24, (x) =>
    rect(ctx, C.woodLine, x, GROUND, 1, ART.height - GROUND),
  );
  rect(ctx, C.woodLine, 0, GROUND, ART.width, 1);
  rect(ctx, C.woodLine, 0, GROUND + 9, ART.width, 1);
}

// ---------------------------------------------------------------- 背景: 通学路

const HOUSE_WALL = ["#f4e1c1", "#e3eef7", "#efd5d5"];
const HOUSE_ROOF = ["#b35a4a", "#5a6f94", "#6b7a52"];

function drawStreetBg(
  ctx: CanvasRenderingContext2D,
  distance: number,
  weather: Weather,
) {
  const sky = SKY[weather];
  rect(ctx, sky.sky, 0, CEILING, ART.width, GROUND - CEILING);
  rect(ctx, sky.light, 0, 60, ART.width, GROUND - 60);
  // 雲 (雨の日は、厚く暗い)
  tiles(distance, 0.1, weather === "sunny" ? 110 : 70, (x, index) => {
    const y = 18 + (index % 3) * 6;
    const wide = weather === "sunny" ? 26 : 40;
    rect(ctx, sky.cloud, x + 20, y + 2, wide, 5);
    rect(ctx, sky.cloud, x + 26, y, wide - 12, 3);
  });
  // 遠くの家
  tiles(distance, 0.35, 90, (x, index) => {
    const height = 28 + (index % 3) * 8;
    rect(ctx, "#9fb4d6", x + 10, GROUND - height, 44, height);
    rect(ctx, "#8aa0c6", x + 8, GROUND - height - 4, 48, 4);
  });
  // 近くの家と電柱
  tiles(distance, 0.65, 130, (x, index) => {
    const k = index % 3;
    const top = GROUND - 44;
    rect(ctx, HOUSE_WALL[k], x + 8, top, 54, 44);
    rect(ctx, HOUSE_ROOF[k], x + 4, top - 10, 62, 10);
    rect(ctx, HOUSE_ROOF[k], x + 10, top - 14, 50, 4);
    rect(ctx, C.window, x + 14, top + 8, 12, 10);
    rect(ctx, C.window, x + 42, top + 8, 12, 10);
    rect(ctx, C.frame, x + 14, top + 12, 12, 1);
    rect(ctx, C.door, x + 30, top + 18, 10, 26);
  });
  tiles(distance, 0.9, 190, (x) => {
    rect(ctx, "#5a4a3a", x + 90, GROUND - 62, 2, 62);
    rect(ctx, "#5a4a3a", x + 84, GROUND - 58, 14, 2);
    rect(ctx, "#3f3a33", x + 80, GROUND - 56, 22, 1);
  });
  // 塀と木
  tiles(distance, 1, 14, (x) => rect(ctx, "#e8e0cc", x, GROUND - 9, 2, 9));
  rect(ctx, "#e8e0cc", 0, GROUND - 7, ART.width, 1);
  tiles(distance, 1, 260, (x) => {
    rect(ctx, "#6b4a2b", x + 150, GROUND - 26, 4, 26);
    rect(ctx, "#4f9a55", x + 142, GROUND - 40, 20, 16);
    rect(ctx, "#5fb067", x + 146, GROUND - 44, 12, 6);
  });
  // 道路
  rect(
    ctx,
    weather === "rain" ? "#4f5668" : C.asphalt,
    0,
    GROUND,
    ART.width,
    ART.height - GROUND,
  );
  rect(
    ctx,
    weather === "rain" ? "#9aa1b2" : C.sidewalk,
    0,
    GROUND,
    ART.width,
    6,
  );
  rect(ctx, "#8d93a3", 0, GROUND + 6, ART.width, 1);
  tiles(distance, 1, 40, (x) => rect(ctx, "#e8e8e8", x, GROUND + 14, 20, 2));
}

/** 雨のすじ (屋外だけ)。時間で流れる。 */
function drawRain(ctx: CanvasRenderingContext2D, time: number) {
  const shift = Math.floor(time * 140);
  for (let k = 0; k < 46; k++) {
    const x = (k * 37 + shift * 0 + ((k * 13) % 7) * 11) % ART.width;
    const y = (k * 23 + shift) % (ART.height - CEILING);
    rect(ctx, "#dfe9f7", (x + (y >> 2)) % ART.width, CEILING + y, 1, 4);
  }
}

// ---------------------------------------------------------------- 小道具: 家のドア・校門・教室のドア

function drawHomeDoor(ctx: CanvasRenderingContext2D, x: number) {
  rect(ctx, "#7a5a3c", x - 8, GROUND - 48, 16, 48);
  rect(ctx, "#dff2ff", x - 6, GROUND - 46, 12, 46);
  rect(ctx, "#926f4b", x - 8, GROUND - 48, 2, 48);
}

function drawGate(ctx: CanvasRenderingContext2D, x: number) {
  rect(ctx, "#c9c4b8", x - 14, GROUND - 46, 7, 46);
  rect(ctx, "#c9c4b8", x + 7, GROUND - 46, 7, 46);
  rect(ctx, "#aaa598", x - 14, GROUND - 46, 1, 46);
  rect(ctx, "#aaa598", x + 7, GROUND - 46, 1, 46);
  rect(ctx, "#8d93a3", x - 16, GROUND - 49, 11, 3);
  rect(ctx, "#8d93a3", x + 5, GROUND - 49, 11, 3);
  rect(ctx, C.plate, x - 5, GROUND - 40, 10, 5);
  rect(ctx, "#8d93a3", x - 7, GROUND - 30, 3, 30); // 開いた門
}

// ---------------------------------------------------------------- 小道具: お母さん・おばさん・踏切・電車

const MOTHER = [
  "...HHHHH...",
  "..HHHHHHH..",
  "..HSSSSSH..",
  "..HSKSKSH..",
  "..HSSSSSH..",
  "...SSSSS...",
  "..PPPPPPP..",
  ".PPWWWWWPP.",
  ".PPWWWWWPP.",
  ".SPWWWWWPS.",
  "..PPPPPPP..",
  "..PPPPPPP..",
  "..PPPPPPP..",
  "...K...K...",
  "...K...K...",
  "..KK...KK..",
];
const MOTHER_COLOR: Record<string, string> = {
  H: "#6b3f18",
  S: C.skin,
  K: C.ink,
  P: "#e58aa0",
  W: "#ffffff",
};

const APRON = ["#e58aa0", "#f2c94c", "#6fa8e6"];

function drawMother(
  ctx: CanvasRenderingContext2D,
  x: number,
  angry: boolean,
  time: number,
  variant: number,
) {
  sprite(
    ctx,
    MOTHER,
    { ...MOTHER_COLOR, P: APRON[variant % 3] },
    x,
    GROUND - MOTHER.length,
  );
  if (angry && Math.floor(time * 6) % 2 === 0) {
    const y = GROUND - MOTHER.length - 7;
    rect(ctx, "#ff3b3b", x + 8, y, 1, 5);
    rect(ctx, "#ff3b3b", x + 6, y + 2, 5, 1);
    rect(ctx, "#ff3b3b", x + 7, y + 1, 3, 3);
  }
}

const OBASAN_LYING = [
  "..GGG...............",
  ".GSSSG..PPPPPPPP....",
  ".GSKSG.PPPPPPPPPP.KK",
  "..SSS..PPPPPPPPPP.KK",
];
const OBASAN_STANDING = [
  "..GGG..",
  ".GGGGG.",
  ".GSSSG.",
  ".GSKSG.",
  "..SSS..",
  ".PPPPP.",
  "PPWWWPP",
  "SPWWWPS",
  ".PPPPP.",
  ".PPPPP.",
  ".PPPPP.",
  "..K.K..",
  "..K.K..",
  ".KK.KK.",
];
const OBASAN_COLOR: Record<string, string> = {
  G: "#d0d0d8",
  S: C.skin,
  K: C.ink,
  P: "#8a5fb0",
  W: "#e8d9f4",
};

function drawObasan(
  ctx: CanvasRenderingContext2D,
  x: number,
  event: Extract<GameEvent, { kind: "obasan" }>,
  time: number,
) {
  const dress = {
    ...OBASAN_COLOR,
    P: ["#8a5fb0", "#4f9a55", "#d9905a"][event.variant % 3],
  };
  if (event.phase === "done" && event.helped) {
    // 起き上がって、手を振っている
    const wave = Math.floor(time * 4) % 2 === 0;
    sprite(ctx, OBASAN_STANDING, dress, x + 6, GROUND - 14);
    rect(ctx, C.skin, x + 5, GROUND - (wave ? 11 : 9), 1, 3);
    rect(ctx, "#ff7b8a", x + 14, GROUND - 17, 2, 2); // ハート
    return;
  }
  sprite(ctx, OBASAN_LYING, dress, x, GROUND - 4);
}

function drawCrossing(
  ctx: CanvasRenderingContext2D,
  x: number,
  event: Extract<GameEvent, { kind: "crossing" }>,
  time: number,
) {
  // 線路 (道を横切る 2 本)
  rect(ctx, "#4a4a55", x - 4, GROUND, 2, ART.height - GROUND);
  rect(ctx, "#4a4a55", x + 4, GROUND, 2, ART.height - GROUND);
  for (let y = GROUND + 2; y < ART.height; y += 5) {
    rect(ctx, "#5a4a3a", x - 6, y, 14, 1);
  }
  const closed =
    event.phase === "ask" ||
    event.phase === "wait" ||
    event.phase === "dash" ||
    event.phase === "blocked";
  // 警報機
  rect(ctx, "#cfcfd6", x + 10, GROUND - 36, 2, 36);
  rect(ctx, "#ffffff", x + 6, GROUND - 32, 10, 2);
  rect(ctx, "#d33b3b", x + 7, GROUND - 31, 3, 1);
  rect(ctx, "#d33b3b", x + 12, GROUND - 31, 3, 1);
  const blink = closed && Math.floor(time * 4) % 2 === 0;
  rect(ctx, blink ? "#ff3b3b" : "#5a1a1a", x + 6, GROUND - 38, 3, 3);
  rect(ctx, blink ? "#5a1a1a" : "#ff3b3b", x + 13, GROUND - 38, 3, 3);
  // 遮断機のさお
  if (closed) {
    for (let y = 0; y < 28; y += 4) {
      rect(
        ctx,
        y % 8 === 0 ? "#ffffff" : "#d33b3b",
        x - 1,
        GROUND - 28 + y,
        3,
        4,
      );
    }
  }
}

const DOG = [
  "..........EE..",
  "..BBBBBBBBBBB.",
  ".TBBBBBBBBBBWK",
  "TBBBBBBBBBBBBB",
  ".BBBBBBBBBBBB.",
  "..BBBBBBBBBB..",
];
const DOG_COLOR: Record<string, string> = {
  B: "#a06a3a",
  T: "#a06a3a",
  E: "#7a4a22",
  W: "#f4e8d0",
  K: C.ink,
};

/** 追ってくる犬 (キャラの後ろから)。走ると、足と舌が動く。 */
const DOG_COAT = ["#a06a3a", "#d9b44a", "#6b6b75"];

function drawDog(
  ctx: CanvasRenderingContext2D,
  x: number,
  time: number,
  variant: number,
) {
  const top = GROUND - 9;
  const coat = DOG_COAT[variant % 3];
  sprite(ctx, DOG, { ...DOG_COLOR, B: coat, T: coat }, x, top);
  const frame = Math.floor(time * 12) % 2;
  rect(ctx, "#7a4a22", x + 2, GROUND - 3, 2, 3 + frame);
  rect(ctx, "#7a4a22", x + 5 - frame, GROUND - 3, 2, 3);
  rect(ctx, "#7a4a22", x + 9, GROUND - 3, 2, 3 + (1 - frame));
  rect(ctx, "#7a4a22", x + 11 + frame, GROUND - 3, 2, 3);
  rect(ctx, "#e0566a", x + 12, top + 4, 2, 1 + frame); // 舌
  rect(ctx, coat, x - 2, top + 1 + frame, 2, 2); // しっぽ
}

const VENDING_COLOR = [
  ["#9e2b20", "#c0392b"],
  ["#1f4f86", "#2f6fb5"],
  ["#2a7a45", "#3a9a5a"],
];

function drawVending(
  ctx: CanvasRenderingContext2D,
  x: number,
  glowing: boolean,
  variant: number,
) {
  const top = GROUND - 30;
  const [dark, body] = VENDING_COLOR[variant % 3];
  rect(ctx, dark, x, top, 14, 30);
  rect(ctx, body, x + 1, top + 1, 12, 28);
  rect(ctx, "#ffffff", x + 2, top + 2, 10, 3);
  rect(ctx, glowing ? "#bfe6ff" : "#1f2a44", x + 2, top + 6, 10, 14);
  const colors = ["#e0566a", "#4f9a55", "#f2c94c"];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      rect(
        ctx,
        colors[(row + col) % 3],
        x + 3 + col * 3,
        top + 8 + row * 4,
        2,
        3,
      );
    }
  }
  rect(ctx, "#dddddd", x + 10, top + 22, 3, 4);
  rect(ctx, "#111111", x + 2, top + 23, 7, 4);
}

const PERSON = [
  "..HHHHH..",
  ".HHHHHHH.",
  ".HSSSSSH.",
  ".HSKSKSH.",
  "..SSSSS..",
  "..UUUUU..",
  ".UUWWWUU.",
  "SUUWWWUUS",
  ".UUUUUUU.",
  ".UUUUUUU.",
  "..PPPPP..",
  "..PP.PP..",
  "..PP.PP..",
  "..KK.KK..",
];

function drawPerson(
  ctx: CanvasRenderingContext2D,
  x: number,
  palette: Record<string, string>,
  bubble: "none" | "dots" | "talk",
  time: number,
) {
  sprite(ctx, PERSON, palette, x, GROUND - PERSON.length);
  if (bubble !== "none") {
    const y = GROUND - PERSON.length - 9;
    rect(ctx, C.white, x + 4, y, 14, 7);
    rect(ctx, C.white, x + 6, y + 7, 2, 2);
    const lit = bubble === "talk" ? Math.floor(time * 4) % 3 : 1;
    for (let k = 0; k < 3; k++) {
      rect(ctx, k === lit ? C.ink : "#9aa5cc", x + 6 + k * 4, y + 3, 2, 2);
    }
  }
}

const FRIEND_HAIR = ["#3a2a1a", "#b5651d", "#d9b44a"];
const FRIEND_UNIFORM = ["#4a6fb5", "#5a8f6a", "#8a6fb5"];
function friendColor(variant: number): Record<string, string> {
  return {
    H: FRIEND_HAIR[variant % 3],
    S: C.skin,
    K: C.ink,
    U: FRIEND_UNIFORM[variant % 3],
    W: C.white,
    P: "#2b3558",
  };
}
const TEACHER_SUIT = ["#555d78", "#3a4a3a", "#5a4a3a"];
function teacherColor(variant: number): Record<string, string> {
  return {
    H: "#8a8a92",
    S: C.skin,
    K: C.ink,
    U: TEACHER_SUIT[variant % 3],
    W: C.white,
    P: "#3a3f55",
  };
}

/** 飛び出してくる自転車 (右から、キャラの前へ)。 */
const SHIRT = ["#3a7bd5", "#d9902a", "#4f9a55"];

function drawBike(ctx: CanvasRenderingContext2D, x: number, variant: number) {
  for (const wx of [x, x + 11]) {
    rect(ctx, C.ink, wx + 1, GROUND - 5, 3, 1);
    rect(ctx, C.ink, wx, GROUND - 4, 1, 3);
    rect(ctx, C.ink, wx + 4, GROUND - 4, 1, 3);
    rect(ctx, C.ink, wx + 1, GROUND - 1, 3, 1);
  }
  rect(ctx, "#d33b3b", x + 2, GROUND - 6, 11, 1);
  rect(ctx, "#d33b3b", x + 6, GROUND - 9, 1, 4);
  rect(ctx, C.ink, x + 11, GROUND - 9, 3, 1);
  rect(ctx, SHIRT[variant % 3], x + 5, GROUND - 15, 3, 6);
  rect(ctx, C.skin, x + 5, GROUND - 19, 4, 4);
  rect(ctx, "#3a2a1a", x + 5, GROUND - 20, 4, 1);
  rect(ctx, "#2b3558", x + 6, GROUND - 9, 2, 3);
}

const TRAIN_STRIPE = ["#3f6fb5", "#4f9a55", "#d9902a"];

function drawTrain(ctx: CanvasRenderingContext2D, x: number, variant: number) {
  const top = GROUND - 38;
  rect(ctx, "#e8ecf6", x, top, 120, 30);
  rect(ctx, TRAIN_STRIPE[variant % 3], x, top + 20, 120, 5);
  rect(ctx, "#cdd3e6", x, top, 120, 2);
  for (let k = 0; k < 5; k++) {
    rect(ctx, C.window, x + 8 + k * 22, top + 6, 16, 10);
    rect(ctx, C.windowLight, x + 9 + k * 22, top + 7, 4, 1);
  }
  rect(ctx, "#2b3558", x + 6, top + 30, 12, 4);
  rect(ctx, "#2b3558", x + 100, top + 30, 12, 4);
}

// ---------------------------------------------------------------- 障害物 (バッグ・ごみ箱・水たまり・猫)

function drawBin(
  ctx: CanvasRenderingContext2D,
  x: number,
  worldWidth: number,
  worldHeight: number,
) {
  const w = Math.max(9, Math.round(worldWidth / 2));
  const h = Math.max(12, Math.round(worldHeight / 2));
  const top = GROUND - h;
  rect(ctx, "#6f7a8c", x, top + 2, w, h - 2);
  rect(ctx, "#8d99ad", x + 1, top + 3, 1, h - 4);
  rect(ctx, "#56606f", x + w - 1, top + 3, 1, h - 3);
  rect(ctx, "#56606f", x - 1, top, w + 2, 2); // ふた
  rect(ctx, "#56606f", x + 2, top + 5, w - 4, 1);
  rect(ctx, "#56606f", x + 2, top + 9, w - 4, 1);
}

function drawPuddle(
  ctx: CanvasRenderingContext2D,
  x: number,
  worldWidth: number,
) {
  const w = Math.max(14, Math.round(worldWidth / 2));
  rect(ctx, "#6f9fd4", x, GROUND - 2, w, 2);
  rect(ctx, "#8fbbe8", x + 2, GROUND - 3, w - 4, 1);
  rect(ctx, "#dff2ff", x + 3, GROUND - 2, 3, 1);
}

function drawCat(
  ctx: CanvasRenderingContext2D,
  x: number,
  worldHeight: number,
  time: number,
) {
  const h = Math.max(9, Math.round(worldHeight / 2));
  const top = GROUND - h;
  rect(ctx, "#d9902a", x + 1, top + 4, 8, h - 4); // 体
  rect(ctx, "#d9902a", x, top, 8, 5); // 頭
  rect(ctx, "#d9902a", x, top - 2, 2, 2); // 耳
  rect(ctx, "#d9902a", x + 6, top - 2, 2, 2);
  rect(ctx, C.ink, x + 2, top + 2, 1, 1);
  rect(ctx, C.ink, x + 5, top + 2, 1, 1);
  const sway = Math.floor(time * 3) % 2;
  rect(ctx, "#d9902a", x + 9, top + 4 - sway, 2, h - 6); // しっぽ
  rect(ctx, "#b87420", x + 2, top + 6, 6, 1);
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  obstacle: Obstacle,
  x: number,
  time: number,
) {
  if (obstacle.kind === "bin") drawBin(ctx, x, obstacle.width, obstacle.height);
  else if (obstacle.kind === "puddle") drawPuddle(ctx, x, obstacle.width);
  else if (obstacle.kind === "cat") drawCat(ctx, x, obstacle.height, time);
  else if (obstacle.kind === "bike") {
    // 左へ走ってくる (左向き)
    ctx.save();
    ctx.translate(x + 16, 0);
    ctx.scale(-1, 1);
    drawBike(ctx, 0, obstacle.variant ?? 0);
    ctx.restore();
  } else drawBag(ctx, x, obstacle.width, obstacle.height);
}

function drawBag(
  ctx: CanvasRenderingContext2D,
  x: number,
  worldWidth: number,
  worldHeight: number,
) {
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
  // 転んで止まっている間は、点滅する
  if (game.stun > 0 && Math.floor(game.time * 12) % 2 === 0) return;
  const x0 = left + character.offsetX;
  character.sprite.forEach((row, rowIndex) => {
    for (let col = 0; col < row.length; col++) {
      const color = character.palette[row[col]];
      if (color) rect(ctx, color, x0 + col, bodyTop + rowIndex, 1, 1);
    }
  });
  const stairs = game.stairs !== null && game.stairs.on ? game.stairs : null;
  const moving = stairs
    ? game.status === "playing" &&
      game.stun <= 0 &&
      game.time - stairs.lastStepAt < 0.18
    : game.status === "playing" && game.active === null && game.stun <= 0;
  const frame = stairs
    ? stairs.steps % 2
    : moving
      ? Math.floor(game.time * (game.exhausted ? 4 : 10)) % 2
      : 0;
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
  if (!air && moving && !stairs) {
    const puff = Math.floor(game.time * 18) % 3;
    rect(ctx, C.dust, left - 2 - puff * 2, GROUND - 2, 1, 1);
    rect(ctx, C.dust, left - 5 - puff * 2, GROUND - 1, 1, 1);
  }
  // ダッシュ: 後ろに、スピード線
  if (moving && game.pace === "dash" && !game.exhausted && !air) {
    const shift = Math.floor(game.time * 30) % 3;
    for (let k = 0; k < 3; k++) {
      rect(ctx, C.white, left - 10 - shift * 2, feet - 7 - k * 5, 7, 1);
    }
  }
  // 息切れ: 汗が落ちる
  if (game.exhausted && game.status === "playing") {
    const drop = Math.floor(game.time * 5) % 3;
    rect(ctx, "#8fd3ff", left + 12, bodyTop + 1 + drop * 2, 1, 2);
    rect(ctx, "#8fd3ff", left - 1, bodyTop + 3 + ((drop + 1) % 3) * 2, 1, 2);
  }
}

// ---------------------------------------------------------------- 1 コマ

const ZONE_COLOR: Record<string, string> = {
  miss: "#d33b3b",
  barely: "#ff7a4a",
  late: "#ff9f4a",
  normal: "#c8e06a",
  good: "#6fd36f",
  perfect: "#ffd84a",
};
const WAKE_BAR = { left: 60, width: 200, top: 46, height: 10 } as const;

/** 目覚ましのバー: 色の並びは、毎回ランダム。赤は二度寝。白いマーカーが往復する。 */
function drawWakeBar(ctx: CanvasRenderingContext2D, game: GameState) {
  const { left, width, top, height } = WAKE_BAR;
  rect(ctx, C.ink, left - 2, top - 2, width + 4, height + 4);
  for (const segment of game.wake.segments) {
    const x0 = left + Math.round(segment.from * width);
    const x1 = left + Math.round(segment.to * width);
    rect(ctx, ZONE_COLOR[segment.zone], x0, top, x1 - x0, height);
    rect(ctx, C.ink, x0, top, 1, height); // 区切り
  }
  // マーカー (止めたら、点滅する)
  const x = left + game.wake.pos * width;
  const flash =
    game.wake.stopped &&
    Math.floor(game.time * 8 + game.wake.pause * 8) % 2 === 0;
  rect(ctx, C.ink, x - 2, top - 6, 5, height + 12);
  rect(ctx, flash ? C.gold : C.white, x - 1, top - 5, 3, height + 10);
}

/** ベッドのそばの目覚まし時計 (鳴っている間は、震える)。 */
function drawAlarmClock(
  ctx: CanvasRenderingContext2D,
  x: number,
  time: number,
) {
  const shake = Math.floor(time * 20) % 2;
  const left = x + shake;
  const top = GROUND - 14;
  rect(ctx, "#d33b3b", left, top + 2, 10, 10);
  rect(ctx, "#fff7e0", left + 1, top + 3, 8, 8);
  rect(ctx, C.ink, left + 5, top + 4, 1, 4);
  rect(ctx, C.ink, left + 5, top + 7, 3, 1);
  rect(ctx, "#a02323", left, top, 3, 3); // ベル
  rect(ctx, "#a02323", left + 7, top, 3, 3);
  rect(ctx, "#5a4a3a", left + 1, GROUND - 2, 2, 2);
  rect(ctx, "#5a4a3a", left + 7, GROUND - 2, 2, 2);
  // 鳴っている線
  if (shake === 0) {
    rect(ctx, C.gold, left - 3, top + 3, 1, 2);
    rect(ctx, C.gold, left + 12, top + 3, 1, 2);
  } else {
    rect(ctx, C.gold, left - 4, top + 6, 1, 2);
    rect(ctx, C.gold, left + 13, top + 6, 1, 2);
  }
}

/** ねむけ (Zzz)。 */
function drawSleepy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
) {
  const lift = Math.floor(time * 3) % 3;
  for (let k = 0; k < 3; k++) {
    const size = 2 + k;
    const zx = x + k * 5;
    const zy = y - k * 5 - lift;
    rect(ctx, C.white, zx, zy, size + 1, 1);
    rect(ctx, C.white, zx + size, zy + 1, 1, 1);
    rect(ctx, C.white, zx + size - 1, zy + 2, 1, 1);
    rect(ctx, C.white, zx, zy + size, size + 1, 1);
  }
}

// ---------------------------------------------------------------- 校舎の階段 (むずかしい)

/** 階段の 1 段: 横に 8 ドット、上に 5 ドット。キャラは、左から 36 ドットの所に立つ。 */
const STAIR = { run: 8, rise: 5, x: 36 } as const;

/** 上った段の数 (絵用): 1 段上がった直後は、少し手前から、なめらかに進む。 */
function stairProgress(game: GameState): number {
  const stairs = game.stairs;
  if (stairs === null) return 0;
  const ease = Math.max(0, 1 - (game.time - stairs.lastStepAt) / 0.1);
  return Math.max(0, stairs.steps + stairs.partial - ease * 0.8);
}

function drawStairs(ctx: CanvasRenderingContext2D, game: GameState) {
  const stairs = game.stairs;
  if (stairs === null) return;
  const total = stairs.flights * STAIR_STEPS;
  const p = stairProgress(game);
  const height = (n: number) => Math.min(Math.max(n, 0), total) * STAIR.rise;
  const here = height(p);
  const topOf = (n: number) => GROUND - (height(n) - here);
  const leftOf = (n: number) => STAIR.x + (n - p) * STAIR.run;

  // 壁
  rect(ctx, C.wall, 0, CEILING, ART.width, ART.height - CEILING);
  rect(ctx, C.wallTop, 0, CEILING, ART.width, 3);
  tiles(p * 14, 0.5, 80, (x) => rect(ctx, C.lamp, x + 22, CEILING + 1, 30, 1));
  tiles(p * 14, 0.4, 96, (x) => drawWindow(ctx, x + 20));

  // 階
  const first = Math.floor(p) - 5;
  for (let n = first; n <= first + 50; n++) {
    const x = leftOf(n);
    if (x > ART.width || x + STAIR.run < 0) continue;
    const top = topOf(n);
    if (top < ART.height) {
      rect(
        ctx,
        n % 2 === 0 ? C.floorAlt : C.floor,
        x,
        top,
        STAIR.run,
        ART.height - top,
      );
      rect(ctx, C.dust, x, top, STAIR.run, 1);
      rect(ctx, C.floorLine, x, top, 1, ART.height - top);
    }
    // 手すり
    rect(ctx, C.baseboard, x, top - 14, STAIR.run, 1);
    if (n % 3 === 0) rect(ctx, C.baseboard, x + 3, top - 14, 1, 14);
  }

  // 階の札 (2F〜) と、6 階の教室
  for (let floor = 2; floor <= TOP_FLOOR; floor++) {
    const n = (floor - 1) * STAIR_STEPS;
    const x = leftOf(n) - (floor === TOP_FLOOR ? 22 : 0);
    const y = topOf(n) - 52;
    if (x < -24 || x > ART.width) continue;
    rect(ctx, C.ink, x - 2, y - 2, 22, 14);
    rect(ctx, C.plate, x - 1, y - 1, 20, 12);
    drawText(ctx, `${floor}F`, x + 2, y, C.ink, 2);
  }
  const doorX = leftOf(total) + 24;
  if (doorX < ART.width) drawDoor(ctx, doorX, 201, topOf(total) - 40);
}

/**
 * 階段の人の絵: 降りてくる人、止める先生、友達。突然は現れない: どの階段の人も、上る前から階段に立っていて、
 * 近づくと見える (先生と友達は、できごとが始まる 3 段先。降りてくる人は、階段の上の踊り場で待っている)。
 */
function drawStairActors(ctx: CanvasRenderingContext2D, game: GameState) {
  const stairs = game.stairs;
  if (stairs === null) return;
  const p = stairProgress(game);
  // 段の数 n の所に、人を立たせる (k は、キャラからの段の数)。見える範囲の外は、描かない
  const person = (
    n: number,
    palette: Record<string, string>,
    bubble: "none" | "dots" | "talk",
    alert: boolean,
  ) => {
    const k = n - p;
    if (k < -2 || k > 36) return;
    const x = Math.round(STAIR.x + k * STAIR.run - 3);
    const y = -Math.round(k * STAIR.rise);
    ctx.save();
    ctx.translate(x, y);
    drawPerson(ctx, 0, palette, bubble, game.time);
    ctx.restore();
    // 近づいたら、頭の上に「!」 (まだ何も起きていない合図)
    if (alert && k < 10) drawAlert(ctx, x + 3, GROUND - 24 + y, game.time);
  };
  stairs.plan.forEach((event, flight) => {
    const n = stairActorStep(flight, event.kind);
    // 終わった人は、キャラが着くまでは、その場に立っている
    const gone = event.phase === "done" && n - p < 1.5;
    if (event.kind === "walker") {
      if (event.phase === "idle") {
        person(n, friendColor(event.variant), "none", true);
      } else if (event.phase === "walk") {
        // 上の踊り場から、おりてくる (いる段は、ゲームの中の位置。ぶつかる所まで、見えている)
        person(event.pos, friendColor(event.variant), "none", false);
      }
    } else if (event.kind === "teacher") {
      if (gone) return;
      person(
        n,
        teacherColor(event.variant),
        event.phase === "stop" ? "talk" : "none",
        false,
      );
      if (event.phase === "stop") {
        // 止まっていなければいけない残り時間
        const left = Math.max(0, 1 - event.elapsed / STAIR_TEACHER_STOP);
        rect(ctx, C.ink, 30, 22, 28, 4);
        rect(ctx, C.alert, 31, 23, Math.round(26 * left), 2);
      }
    } else if (!gone) {
      person(
        n,
        friendColor(event.variant),
        event.phase === "talk"
          ? "talk"
          : event.phase === "ask"
            ? "dots"
            : "none",
        false,
      );
    }
  });
}

/** 頭の上の「!」 (点滅する)。これから、何かが起きる合図。 */
function drawAlert(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
) {
  if (Math.floor(time * 5) % 2 === 0) return;
  rect(ctx, C.alert, x, y, 2, 6);
  rect(ctx, C.alert, x, y + 7, 2, 2);
}

/** 場面の区間 [from, to) だけに、描く範囲を絞る (境目は、ドアと校門が隠す)。 */
function clipped(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  draw: () => void,
) {
  const left = Math.max(0, x0);
  const right = Math.min(ART.width, x1);
  if (right <= left) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, CEILING, right - left, ART.height - CEILING);
  ctx.clip();
  draw();
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, game: GameState) {
  // 起床チャレンジの間は、目覚ましの時刻を出す
  const minute =
    game.status === "waking" ? WAKE_ALARM_MINUTE : clockMinute(game);
  const remaining = DEADLINE_MINUTE - minute;
  // タイムアタック: 時刻ではなく、家を出てからの時間 (分:秒)。締め切りはない
  const attack = game.mode === "timeattack";
  const seconds = Math.floor(game.time);
  const clockLabel = attack
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
    : clockText(minute);
  rect(ctx, C.ceiling, 0, 0, ART.width, CEILING);
  // いまの時刻 (締め切りが近づくと、赤くなる)
  const late = !attack && remaining < 10;
  drawText(ctx, clockLabel, 6, 2, late ? C.alert : C.hud, 2);
  // スタミナ: ダッシュで減る。息切れのときは、赤く点滅する
  const gaugeLeft = 46;
  const gaugeWidth = 56;
  rect(ctx, C.gold, gaugeLeft - 5, 3, 3, 1); // 稲妻
  rect(ctx, C.gold, gaugeLeft - 6, 4, 3, 2);
  rect(ctx, C.gold, gaugeLeft - 5, 6, 3, 1);
  rect(ctx, C.gold, gaugeLeft - 4, 7, 2, 2);
  rect(ctx, "#4a5680", gaugeLeft, 4, gaugeWidth, 5);
  const level = Math.max(0, game.stamina) / STAMINA_MAX;
  const gaugeColor = game.exhausted
    ? Math.floor(game.time * 6) % 2 === 0
      ? "#ff5a5a"
      : "#8a2a2a"
    : level > 0.5
      ? "#6fd36f"
      : level > 0.25
        ? "#ffd84a"
        : "#ff8a4a";
  rect(ctx, gaugeColor, gaugeLeft, 4, Math.round(gaugeWidth * level), 5);
  // 道のり: 家から教室まで
  const barLeft = 112;
  const barWidth = 96;
  rect(ctx, "#4a5680", barLeft, 6, barWidth, 3);
  const road = game.distance / game.routeLength;
  const stairs = game.stairs;
  // 階段があるときは、道のりの 8 割 + 階段の 2 割
  const ratio = stairs
    ? 0.8 * road + (0.2 * stairs.steps) / (stairs.flights * STAIR_STEPS)
    : road;
  const done = Math.round(barWidth * ratio);
  rect(ctx, C.gold, barLeft, 6, done, 3);
  rect(ctx, C.alert, barLeft + Math.min(barWidth - 2, done), 3, 2, 8);
  // 締め切り (旗と時刻)。タイムアタックには、ない
  if (!attack) {
    const limit = clockText(DEADLINE_MINUTE);
    const textX = ART.width - 6 - textWidth(limit, 2);
    drawText(ctx, limit, textX, 2, C.hud, 2);
    rect(ctx, C.hud, textX - 8, 2, 1, 9);
    rect(ctx, C.alert, textX - 7, 2, 5, 4);
  }
  // 階段: いまの階
  if (stairs !== null && stairs.on) {
    const label = `${floorOf(stairs)}F`;
    const x = Math.round(ART.width / 2 - textWidth(label, 3) / 2);
    drawText(ctx, label, x + 1, 19, C.ink, 3);
    drawText(ctx, label, x, 18, C.white, 3);
  }
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  character: Character = CHARACTERS[0],
) {
  const d = game.distance / 2;
  const edge = (at: number) => screenX(at, game.distance);
  // 場面の切れ目は、道のりの長さ (難易度) に合わせる
  const scale = DIFFICULTIES[game.difficulty].routeScale;
  const homeEnd = edge(STAGE_STARTS[1].from * scale);
  const schoolStart = edge(STAGE_STARTS[2].from * scale);
  ctx.clearRect(0, 0, ART.width, ART.height);

  // 校舎の階段 (むずかしい): 教室までの道のりが終わると、この絵になる
  if (game.stairs !== null && game.stairs.on) {
    drawStairs(ctx, game);
    drawStairActors(ctx, game);
    drawPlayer(ctx, game, character);
    drawHud(ctx, game);
    return;
  }

  // 場面ごとの背景
  clipped(ctx, -9999, homeEnd, () => drawHomeBg(ctx, d, game.weather));
  clipped(ctx, homeEnd, schoolStart, () => drawStreetBg(ctx, d, game.weather));
  clipped(ctx, schoolStart, 9999, () => drawSchoolBg(ctx, d));
  // 境目のドアと校門、ゴールの教室のドア
  drawHomeDoor(ctx, homeEnd);
  drawGate(ctx, schoolStart);
  drawDoor(ctx, edge(game.routeLength + 20) - 8, game.stairs ? "1F" : 201);

  const crossing = game.events.find((item) => item.kind === "crossing");
  // 電車 (踏切の向こうを、右から左へ通る)
  if (crossing && (crossing.phase === "wait" || crossing.phase === "blocked")) {
    const span = crossing.phase === "wait" ? CROSSING_WAIT : 4;
    const progress = Math.min(
      1,
      Math.max(0, (crossing.elapsed - 0.4) / (span - 1)),
    );
    drawTrain(
      ctx,
      Math.round(ART.width - progress * (ART.width + 130)),
      crossing.variant,
    );
  }

  // できごとの小道具 (起床チャレンジの間は、まだ出さない)
  const waking = game.status === "waking";
  for (const event of waking ? [] : game.events) {
    if (event.kind === "mother") {
      drawMother(
        ctx,
        edge(event.at + 80),
        event.phase === "scold",
        game.time,
        event.variant,
      );
    } else if (event.kind === "obasan") {
      drawObasan(ctx, edge(event.at), event, game.time);
    } else if (event.kind === "crossing") {
      drawCrossing(ctx, edge(event.at), event, game.time);
    } else if (event.kind === "vending") {
      drawVending(ctx, edge(event.at), event.phase === "drink", event.variant);
    } else if (event.kind === "friend") {
      drawPerson(
        ctx,
        edge(event.at),
        friendColor(event.variant),
        event.phase === "ask"
          ? "dots"
          : event.phase === "talk"
            ? "talk"
            : "none",
        game.time,
      );
    } else if (event.kind === "teacher") {
      drawPerson(
        ctx,
        edge(event.at + 100),
        teacherColor(event.variant),
        event.phase === "greet" ? "talk" : "none",
        game.time,
      );
    } else if (event.kind === "bike" && event.phase === "idle") {
      // 道の先の脇道で、待っている (近づくと、「!」が出る)
      // (走り出したあとは、障害物として描く)
      const x = edge(event.at);
      if (x < ART.width + 4) {
        ctx.save();
        ctx.translate(x + 16, 0);
        ctx.scale(-1, 1);
        drawBike(ctx, 0, event.variant);
        ctx.restore();
        if (x < 200) drawAlert(ctx, x + 5, GROUND - 28, game.time);
      }
    } else if (event.kind === "dog" && event.phase === "idle") {
      // 道の先に、犬がいる (こちらを向いている。近づくと、「!」が出る)
      const x = edge(event.at);
      if (x > -20 && x < ART.width + 4) {
        ctx.save();
        ctx.translate(x + 14, 0);
        ctx.scale(-1, 1);
        drawDog(ctx, 0, game.time / 4, event.variant);
        ctx.restore();
        if (x < 200) drawAlert(ctx, x + 5, GROUND - 22, game.time);
      }
    }
  }
  // 追ってくる犬
  if (game.chase && !waking) {
    // 犬との距離が縮むほど、キャラに近づく (最初の距離でも、画面の端に見える)。
    // 立っていた場所から走り出す: 最初は、その場所に見え、そこから後ろへ流れて、追いかける位置につく
    drawDog(
      ctx,
      Math.max(edge(game.chase.at), Math.round(36 - game.chase.gap / 6 - 14)),
      game.time,
      game.chase.variant,
    );
  }

  // 障害物 (おばさんの体は、おばさんの絵で描く)
  for (const obstacle of waking ? [] : game.obstacles) {
    if (obstacle.body) continue;
    const x = edge(obstacle.at);
    if (x > -20 && x < ART.width + 4) {
      drawObstacle(ctx, obstacle, x, game.time);
    }
  }

  drawPlayer(ctx, game, character);
  if (waking) {
    drawAlarmClock(ctx, 128, game.time);
    drawSleepy(ctx, 44, GROUND - 24, game.time);
    drawWakeBar(ctx, game);
  }
  // 雨 (屋外だけ)
  if (game.weather === "rain") {
    clipped(ctx, homeEnd, schoolStart, () => drawRain(ctx, game.time));
  }
  drawHud(ctx, game);
}
