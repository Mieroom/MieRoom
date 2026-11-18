import { describe, expect, it } from "vitest";
import {
  isBetter,
  isPlausibleValue,
  MAX_SCORE,
  MAX_TENTHS,
  minPlausibleTenths,
  NICKNAME_MAX,
  normalizeNickname,
} from "@/lib/domain/mini-game-ranking";

// ミニゲームのランキングの規則: ニックネーム、送られた記録の範囲、良し悪しの比べ方。

describe("ニックネーム", () => {
  it("1〜12 文字。前後の空白は取り、続く空白はひとつにする", () => {
    expect(normalizeNickname("たろう")).toBe("たろう");
    expect(normalizeNickname("  たろう  ")).toBe("たろう");
    expect(normalizeNickname("たろう   じろう")).toBe("たろう じろう");
    expect(normalizeNickname("あ")).toBe("あ");
    expect(normalizeNickname("あ".repeat(NICKNAME_MAX))).toBe(
      "あ".repeat(NICKNAME_MAX),
    );
  });
  it("長さは、文字の数で数える (絵文字や、2 つの符号でできた文字も 1 文字)", () => {
    expect(normalizeNickname("😀".repeat(NICKNAME_MAX))).not.toBeNull();
    expect(normalizeNickname("😀".repeat(NICKNAME_MAX + 1))).toBeNull();
    expect(normalizeNickname("あ".repeat(NICKNAME_MAX + 1))).toBeNull();
  });
  it("全角・半角は、そろえる (NFKC)", () => {
    expect(normalizeNickname("ＡＢＣ１２３")).toBe("ABC123");
    expect(normalizeNickname("ﾀﾛｳ")).toBe("タロウ");
  });
  it("空、空白だけ、文字でない値は使えない", () => {
    for (const value of ["", "   ", "　　", undefined, null, 12, {}, []]) {
      expect(normalizeNickname(value), String(value)).toBeNull();
    }
  });
  it("制御文字・見えない文字・向きを変える記号は使えない", () => {
    for (const value of [
      "ab\u0000c",
      "ab\nc".replace("\n", "\u0007"),
      "a​b", // 幅のない空白
      "a‮b", // 右から左へ
      "a﻿b",
      "a b",
    ]) {
      expect(normalizeNickname(value), JSON.stringify(value)).toBeNull();
    }
  });
  it("メールアドレスと URL の形は使えない", () => {
    for (const value of [
      "a@b.c",
      "@taro",
      "http://x",
      "https://x.example",
      "www.x.jp",
      "ｈｔｔｐｓ://ｘ", // 全角でも、そろえてから確かめる
    ]) {
      expect(normalizeNickname(value), value).toBeNull();
    }
  });
  it("極端に長い入力は、整える前に断る", () => {
    expect(normalizeNickname("あ".repeat(10_000))).toBeNull();
  });
});

describe("送られた記録の範囲", () => {
  it("通常: 1 点から上限まで。整数だけ", () => {
    expect(isPlausibleValue("normal", "hard", 1)).toBe(true);
    expect(isPlausibleValue("normal", "hard", 300)).toBe(true);
    expect(isPlausibleValue("normal", "hard", MAX_SCORE)).toBe(true);
    for (const value of [
      0,
      -1,
      MAX_SCORE + 1,
      1.5,
      NaN,
      Infinity,
      "300",
      null,
      undefined,
    ]) {
      expect(isPlausibleValue("normal", "hard", value), String(value)).toBe(
        false,
      );
    }
  });
  it("タイムアタック: 下限より速い記録と、1 時間より遅い記録は断る", () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const min = minPlausibleTenths(difficulty);
      expect(min).toBeGreaterThan(100); // 10 秒より速くは着けない
      expect(isPlausibleValue("timeattack", difficulty, min)).toBe(true);
      expect(isPlausibleValue("timeattack", difficulty, min - 1)).toBe(false);
      expect(isPlausibleValue("timeattack", difficulty, 0)).toBe(false);
      expect(isPlausibleValue("timeattack", difficulty, MAX_TENTHS)).toBe(true);
      expect(isPlausibleValue("timeattack", difficulty, MAX_TENTHS + 1)).toBe(
        false,
      );
      expect(isPlausibleValue("timeattack", difficulty, 450.5)).toBe(false);
    }
  });
  it("下限は、道のりが短い難易度ほど小さい。いちばん速い走りでも、本当に出せる時間より遅くない", () => {
    expect(minPlausibleTenths("easy")).toBeLessThan(
      minPlausibleTenths("normal"),
    );
    // ふつう: 道のり 15680px (-5%) を、ダッシュ+飴 (582 px/s) のままで走る: 約 25.6 秒
    expect(minPlausibleTenths("normal")).toBe(
      Math.floor(((15680 * 0.95) / (280 * 1.6 * 1.3)) * 10),
    );
  });
});

describe("良し悪しの比べ方", () => {
  it("通常は高いほど、タイムアタックは低いほど良い。同じは、良くない", () => {
    expect(isBetter("normal", 301, 300)).toBe(true);
    expect(isBetter("normal", 300, 300)).toBe(false);
    expect(isBetter("normal", 299, 300)).toBe(false);
    expect(isBetter("timeattack", 299, 300)).toBe(true);
    expect(isBetter("timeattack", 300, 300)).toBe(false);
    expect(isBetter("timeattack", 301, 300)).toBe(false);
  });
});
