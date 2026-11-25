// 単体テストと結合テストのカバレッジを合算する(テスト方針 段階 C)。
// 「どちらかのテストで通った文・分岐・関数」を、通ったものとして数える。
// 入力は、vitest の coverage-final.json(istanbul 形式)。同じファイルは、同じ位置の対応表を持つ前提で、
// 件数が違えば、合算せずにエラーにする(別の版のソースを混ぜて、数字がずれるのを防ぐ)。

import { z } from "zod";

const fileCoverageSchema = z.object({
  s: z.record(z.string(), z.number()),
  f: z.record(z.string(), z.number()),
  b: z.record(z.string(), z.array(z.number())),
});

export const coverageFinalSchema = z.record(z.string(), fileCoverageSchema);
export type CoverageFinal = z.infer<typeof coverageFinalSchema>;

export type Counts = { covered: number; total: number };
export type FileSummary = {
  statements: Counts;
  branches: Counts;
  functions: Counts;
};
export type MergedSummary = {
  files: Record<string, FileSummary>;
  total: FileSummary;
};

const zero = (): Counts => ({ covered: 0, total: 0 });

function sameKeys(a: object, b: object): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b);
}

// Windows の区切り(\)を / にそろえ、リポジトリの中のパス(最初の lib/ か app/ から)にする。
export function repoPath(p: string): string {
  const slashed = p.replaceAll(String.fromCharCode(92), "/");
  const m = /(?:^|\/)((?:lib|app)\/.*)$/.exec(slashed);
  return m ? m[1] : slashed;
}

export function mergeCoverage(runs: readonly CoverageFinal[]): MergedSummary {
  const byPath = new Map<string, CoverageFinal[string][]>();
  for (const run of runs) {
    for (const [file, cov] of Object.entries(run)) {
      const key = repoPath(file);
      const list = byPath.get(key) ?? [];
      list.push(cov);
      byPath.set(key, list);
    }
  }

  const files: Record<string, FileSummary> = {};
  const total: FileSummary = {
    statements: zero(),
    branches: zero(),
    functions: zero(),
  };

  for (const [file, covs] of [...byPath.entries()].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const first = covs[0];
    for (const c of covs) {
      if (
        !sameKeys(first.s, c.s) ||
        !sameKeys(first.f, c.f) ||
        !sameKeys(first.b, c.b) ||
        Object.keys(first.b).some((k) => first.b[k].length !== c.b[k].length)
      ) {
        throw new Error(
          `${file}: 実行どうしで、文・関数・分岐の数が違います(別のソースの結果が混ざっています)`,
        );
      }
    }
    const summary: FileSummary = {
      statements: zero(),
      branches: zero(),
      functions: zero(),
    };
    for (const k of Object.keys(first.s)) {
      summary.statements.total++;
      if (covs.some((c) => c.s[k] > 0)) summary.statements.covered++;
    }
    for (const k of Object.keys(first.f)) {
      summary.functions.total++;
      if (covs.some((c) => c.f[k] > 0)) summary.functions.covered++;
    }
    for (const k of Object.keys(first.b)) {
      for (let i = 0; i < first.b[k].length; i++) {
        summary.branches.total++;
        if (covs.some((c) => c.b[k][i] > 0)) summary.branches.covered++;
      }
    }
    files[file] = summary;
    for (const m of ["statements", "branches", "functions"] as const) {
      total[m].covered += summary[m].covered;
      total[m].total += summary[m].total;
    }
  }
  return { files, total };
}

export function pct({ covered, total }: Counts): number {
  return total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;
}
