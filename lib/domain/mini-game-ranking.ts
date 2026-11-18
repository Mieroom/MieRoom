// ミニゲームのランキング (隠し要素。外部設計書にはない) の、規則だけ。サーバーも画面も、ここを使う。
// 点数・タイムはブラウザから送られてくるので、信用しすぎない: 範囲だけ確かめる (改ざんを完全には防がない)。

import {
  BOOST_RATE,
  DASH_RATE,
  DIFFICULTIES,
  ROUTE_LENGTH,
  RUN_SPEED,
  STAIR_STEPS,
  type Difficulty,
  type Mode,
} from "./mini-game";

/** ランキングに出す人数。 */
export const RANKING_SIZE = 10;
/** ニックネームの長さ (文字数)。 */
export const NICKNAME_MAX = 12;
/** 通常モードの点数の上限 (余裕 75 分 + いい行いの合計より、少し上)。 */
export const MAX_SCORE = 1000;
/** タイムアタックの上限 (0.1 秒の数)。1 時間。 */
export const MAX_TENTHS = 36_000;

export const RANKING_MESSAGES = {
  nickname: `ニックネームは 1〜${NICKNAME_MAX} 文字で、メールアドレスや URL は使えません。`,
  invalid: "記録を受け付けられませんでした。",
  forbidden: "この操作はできません。",
} as const;

/**
 * ニックネームを整える。使えなければ null。
 * 全角・半角をそろえ (NFKC)、前後の空白を取り、続く空白をひとつにする。制御文字・見えない文字 (幅のない
 * 空白、向きを変える記号) は使えない。メールアドレスと URL の形も使えない (個人情報や宣伝を載せないため)。
 */
export function normalizeNickname(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  const normalized = value.normalize("NFKC");
  // 空白をまとめる前に確かめる (見えない文字や改行は、JavaScript の空白に入るため、まとめると普通のスペースに化ける)
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(normalized)) return null;
  const name = normalized.replace(/\s+/g, " ").trim();
  const length = [...name].length;
  if (length < 1 || length > NICKNAME_MAX) return null;
  if (/@|:\/\/|https?|www\./i.test(name)) return null;
  return name;
}

/**
 * タイムアタックで、これより速くは着けない時間 (0.1 秒の数。切り捨て)。いちばん短い道のり (-5%)
 * を、ダッシュと飴の速さ (ずっとは続かない) で走り続け、階段も 1 秒に 20 回押した、と考えた下限。
 * ふつうの人の記録は、これよりずっと遅い (下限は、正しい記録を間違って断らないための、ゆるい値)。
 */
export function minPlausibleTenths(difficulty: Difficulty): number {
  const config = DIFFICULTIES[difficulty];
  const road =
    (ROUTE_LENGTH * config.routeScale * 0.95) /
    (RUN_SPEED * DASH_RATE * BOOST_RATE);
  const stairs = (config.flights * STAIR_STEPS) / 20;
  return Math.floor((road + stairs) * 10);
}

/** 送られてきた記録が、ありえる範囲か (整数。通常は 1〜上限の点、タイムアタックは下限〜1 時間)。 */
export function isPlausibleValue(
  mode: Mode,
  difficulty: Difficulty,
  value: unknown,
): value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  if (mode === "normal") return value >= 1 && value <= MAX_SCORE;
  return value >= minPlausibleTenths(difficulty) && value <= MAX_TENTHS;
}

/** value は、than より良い記録か (通常は高いほど、タイムアタックは低いほど良い)。 */
export function isBetter(mode: Mode, value: number, than: number): boolean {
  return mode === "timeattack" ? value < than : value > than;
}

/** 記録の表示: 通常は「310 点」、タイムアタックは「45.3 秒」(0.1 秒の数から)。 */
export function formatValue(mode: Mode, value: number): string {
  return mode === "timeattack"
    ? `${(value / 10).toFixed(1)} 秒`
    : `${value} 点`;
}

/** ランキングの 1 行。本名・メール・ユーザー ID は、ここに入れない。 */
export type RankingEntry = {
  rank: number;
  nickname: string;
  /** 通常は点数、タイムアタックは 0.1 秒の数 */
  value: number;
  /** 自分の記録 */
  isMe: boolean;
};

export type RankingBoard = {
  mode: Mode;
  difficulty: Difficulty;
  /** 上位 (最大 RANKING_SIZE 人) */
  entries: RankingEntry[];
  /** 自分の記録 (上位に入っていなくても出す)。まだなければ null */
  me: RankingEntry | null;
};

/** 登録の結果 (画面に返す)。 */
export type SubmitResult =
  | { kind: "saved"; rank: number }
  | { kind: "not_best"; best: number }
  | { kind: "invalid"; message: string };
