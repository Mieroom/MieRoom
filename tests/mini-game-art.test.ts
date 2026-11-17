import { describe, expect, it } from "vitest";
import { CHARACTERS } from "@/components/screens/mini-game-art";

// 「遅刻ダッシュ」のキャラのドット絵: 絵の大きさと、色の指定がそろっていること。

describe("キャラの絵", () => {
  it("5 種類。ピンが最初。名前と ID は重ならない", () => {
    expect(CHARACTERS).toHaveLength(5);
    expect(CHARACTERS[0].id).toBe("pin");
    expect(new Set(CHARACTERS.map((item) => item.id)).size).toBe(5);
    expect(new Set(CHARACTERS.map((item) => item.name)).size).toBe(5);
  });
  it("どの絵も 14 行。幅は同じで、枠 (13 ドット) からはみ出さない。使う文字は、すべて色がある", () => {
    for (const character of CHARACTERS) {
      expect(character.sprite, character.id).toHaveLength(14);
      const width = character.sprite[0].length;
      for (const row of character.sprite) {
        expect(row.length, `${character.id}: ${row}`).toBe(width);
        for (const char of row) {
          if (char !== ".") {
            expect(
              character.palette[char],
              `${character.id}: ${char}`,
            ).toBeTruthy();
          }
        }
      }
      expect(character.offsetX + width, character.id).toBeLessThanOrEqual(13);
    }
  });
  it("体の一番下の行に絵がある (足が体から離れない)", () => {
    for (const character of CHARACTERS) {
      expect(/[^.]/.test(character.sprite[13]), character.id).toBe(true);
    }
  });
});
