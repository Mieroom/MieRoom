import { describe, expect, it } from "vitest";
import {
  mergeCoverage,
  pct,
  repoPath,
  type CoverageFinal,
} from "@/scripts/coverage/merge";

// 期待値は、「どちらかの実行で通っていれば、通った」という定義から、手で数えて決めている。
const BS = String.fromCharCode(92);

const file = (
  s: Record<string, number>,
  f: Record<string, number>,
  b: Record<string, number[]>,
): CoverageFinal[string] => ({ s, f, b });

describe("カバレッジの合算(mergeCoverage)", () => {
  it("文・関数・分岐は、どちらかで通っていれば、通った数に入る", () => {
    const unit: CoverageFinal = {
      "/repo/lib/domain/a.ts": file(
        { "0": 1, "1": 0, "2": 0, "3": 0 },
        { "0": 1, "1": 0 },
        { "0": [1, 0], "1": [0, 0, 0] },
      ),
    };
    const integ: CoverageFinal = {
      "/repo/lib/domain/a.ts": file(
        { "0": 0, "1": 3, "2": 0, "3": 0 },
        { "0": 0, "1": 0 },
        { "0": [0, 2], "1": [0, 0, 1] },
      ),
    };
    const m = mergeCoverage([unit, integ]);
    const a = m.files["lib/domain/a.ts"];
    // 文: 0 と 1 が通った = 2/4
    expect(a.statements).toEqual({ covered: 2, total: 4 });
    // 関数: 0 だけ = 1/2
    expect(a.functions).toEqual({ covered: 1, total: 2 });
    // 分岐: 1 つ目の 2 本(両方)+ 2 つ目の 3 本目だけ = 3/5
    expect(a.branches).toEqual({ covered: 3, total: 5 });
    expect(m.total).toEqual(a);
  });

  it("片方にしかないファイルも数える(通っていなければ 0)", () => {
    const unit: CoverageFinal = {
      "/repo/lib/domain/a.ts": file({ "0": 1 }, {}, {}),
    };
    const integ: CoverageFinal = {
      "/repo/app/x/route.ts": file({ "0": 0, "1": 0 }, {}, {}),
    };
    const m = mergeCoverage([unit, integ]);
    expect(m.files["lib/domain/a.ts"].statements).toEqual({
      covered: 1,
      total: 1,
    });
    expect(m.files["app/x/route.ts"].statements).toEqual({
      covered: 0,
      total: 2,
    });
    expect(m.total.statements).toEqual({ covered: 1, total: 3 });
  });

  it("実行どうしで文・関数・分岐の数が違えば、合算せずにエラーにする", () => {
    const base = file({ "0": 1 }, { "0": 1 }, { "0": [1, 0] });
    const path = "/repo/lib/domain/a.ts";
    expect(() =>
      mergeCoverage([
        { [path]: base },
        { [path]: file({ "0": 1, "1": 1 }, { "0": 1 }, { "0": [1, 0] }) },
      ]),
    ).toThrow(/数が違います/);
    expect(() =>
      mergeCoverage([
        { [path]: base },
        { [path]: file({ "0": 1 }, { "0": 1, "1": 0 }, { "0": [1, 0] }) },
      ]),
    ).toThrow(/数が違います/);
    expect(() =>
      mergeCoverage([
        { [path]: base },
        { [path]: file({ "0": 1 }, { "0": 1 }, { "0": [1, 0, 0] }) },
      ]),
    ).toThrow(/数が違います/);
  });

  it("実行が 1 つでも、そのまま数える", () => {
    const m = mergeCoverage([
      { "/r/lib/server/s.ts": file({ "0": 2, "1": 0 }, {}, {}) },
    ]);
    expect(m.total.statements).toEqual({ covered: 1, total: 2 });
  });
});

describe("パスの正規化(repoPath)", () => {
  it("Windows の区切りも、/ にそろえて、lib/ か app/ から始める", () => {
    expect(
      repoPath(`C:${BS}Users${BS}x${BS}MieRoom${BS}lib${BS}domain${BS}a.ts`),
    ).toBe("lib/domain/a.ts");
    expect(
      repoPath("/home/runner/work/MieRoom/MieRoom/app/api/x/route.ts"),
    ).toBe("app/api/x/route.ts");
    expect(repoPath("lib/server/s.ts")).toBe("lib/server/s.ts");
  });
});

describe("割合(pct)", () => {
  it("小数 2 桁で丸める。0 件のときは 100", () => {
    expect(pct({ covered: 2189, total: 2240 })).toBe(97.72);
    expect(pct({ covered: 1, total: 3 })).toBe(33.33);
    expect(pct({ covered: 0, total: 0 })).toBe(100);
  });
});
