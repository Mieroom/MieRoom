import { describe, expect, it } from "vitest";
import {
  FLOORS,
  checkFloors,
  summarizeArea,
  type Floor,
} from "@/scripts/coverage/floors";
import type {
  Counts,
  FileSummary,
  MergedSummary,
} from "@/scripts/coverage/merge";

// 期待値は、「covered * 100 >= 下限 * total なら満たす」という定義から、手で決めている。
const c = (covered: number, total: number): Counts => ({ covered, total });
const file = (
  statements: Counts,
  branches: Counts = c(0, 0),
  functions: Counts = c(0, 0),
): FileSummary => ({ statements, branches, functions });

const merged = (files: Record<string, FileSummary>): MergedSummary => ({
  files,
  total: file(c(0, 0)), // checkFloors は files から数える(total は使わない)
});

const floor = (
  name: string,
  prefix: string,
  statements: number,
  branches = 0,
  functions = 0,
): Floor => ({ name, prefix, min: { statements, branches, functions } });

describe("下限の判定(checkFloors)", () => {
  it("下限ちょうどは通り、1 つ足りなければ失敗する(文)", () => {
    const f = [floor("全体", "", 92)];
    expect(checkFloors(merged({ "lib/a.ts": file(c(92, 100)) }), f)).toEqual(
      [],
    );
    const problems = checkFloors(merged({ "lib/a.ts": file(c(91, 100)) }), f);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("全体の文が下限を下回っています");
    expect(problems[0]).toContain("91.00% (91/100) < 92%");
  });

  it("小数の丸めに左右されない(98% の下限に 49/50 は、ちょうど通る)", () => {
    const f = [floor("全体", "", 98)];
    expect(checkFloors(merged({ "lib/a.ts": file(c(49, 50)) }), f)).toEqual([]);
    expect(
      checkFloors(merged({ "lib/a.ts": file(c(48, 50)) }), f),
    ).toHaveLength(1);
  });

  it("複数のファイルは、足してから比べる(1 つが低くても、全体が下限以上なら通る)", () => {
    const f = [floor("全体", "", 90)];
    const m = merged({
      "lib/a.ts": file(c(100, 100)),
      "lib/b.ts": file(c(80, 100)), // 合計 180/200 = 90%
    });
    expect(checkFloors(m, f)).toEqual([]);
    const m2 = merged({
      "lib/a.ts": file(c(100, 100)),
      "lib/b.ts": file(c(79, 100)), // 179/200 = 89.5%
    });
    expect(checkFloors(m2, f)).toHaveLength(1);
  });

  it("文・分岐・関数を、それぞれ別に判定する", () => {
    const f = [floor("全体", "", 50, 50, 50)];
    const m = merged({
      "lib/a.ts": file(c(100, 100), c(49, 100), c(100, 100)),
    });
    const problems = checkFloors(m, f);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("分岐");
    const m2 = merged({
      "lib/a.ts": file(c(10, 100), c(10, 100), c(10, 100)),
    });
    expect(checkFloors(m2, f)).toHaveLength(3);
  });

  it("領域は、パスの先頭で分ける。全体が下限以上でも、領域が下回れば失敗する", () => {
    const f = [floor("全体", "", 90), floor("lib/domain", "lib/domain/", 98)];
    const m = merged({
      "lib/domain/a.ts": file(c(97, 100)), // 領域だけ 97% < 98%
      "lib/server/b.ts": file(c(100, 100)),
      "app/x/route.ts": file(c(100, 100)),
    });
    // 全体は 297/300 = 99%
    const problems = checkFloors(m, f);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("lib/domainの文が下限を下回っています");
    // lib/domain/ で始まらないパス(lib/domain-x/)は、領域に入れない
    const m2 = merged({
      "lib/domain/a.ts": file(c(98, 100)),
      "lib/domain-x/b.ts": file(c(0, 100)),
    });
    expect(checkFloors(m2, [floor("lib/domain", "lib/domain/", 98)])).toEqual(
      [],
    );
  });

  it("対象のファイルが 0 件なら、通さずに失敗にする(パスの変更で何も測らなくなるのを防ぐ)", () => {
    const problems = checkFloors(merged({ "lib/server/b.ts": file(c(1, 1)) }), [
      floor("lib/domain", "lib/domain/", 98),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("対象のファイルが 0 件");
    expect(checkFloors(merged({}), [floor("全体", "", 1)])).toHaveLength(1);
  });

  it("分母が 0 の指標(分岐のないファイルだけなど)は、判定しない", () => {
    const m = merged({ "lib/a.ts": file(c(1, 1), c(0, 0), c(0, 0)) });
    expect(checkFloors(m, [floor("全体", "", 100, 100, 100)])).toEqual([]);
  });
});

describe("領域の集計(summarizeArea)", () => {
  it("パスの先頭が合うファイルだけを、数えて足す", () => {
    const m = merged({
      "lib/domain/a.ts": file(c(1, 2), c(3, 4), c(5, 6)),
      "lib/domain/b.ts": file(c(10, 20), c(30, 40), c(50, 60)),
      "lib/server/c.ts": file(c(7, 7), c(7, 7), c(7, 7)),
    });
    const a = summarizeArea(m, "lib/domain", "lib/domain/");
    expect(a.fileCount).toBe(2);
    expect(a.counts.statements).toEqual({ covered: 11, total: 22 });
    expect(a.counts.branches).toEqual({ covered: 33, total: 44 });
    expect(a.counts.functions).toEqual({ covered: 55, total: 66 });
  });
});

describe("決めた下限(FLOORS。2026-11-25 に決定)", () => {
  it("下げるときは、このテストも変える(うっかり下げて通ってしまうのを防ぐ)", () => {
    expect(FLOORS).toEqual([
      {
        name: "全体",
        prefix: "",
        min: { statements: 92, branches: 91, functions: 87 },
      },
      {
        name: "lib/domain",
        prefix: "lib/domain/",
        min: { statements: 98, branches: 96, functions: 98 },
      },
    ]);
  });
});
