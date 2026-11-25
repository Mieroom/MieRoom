// カバレッジの下限(テスト方針 段階 C)。合算(単体 + 結合)の数字が、下限を下回ったら失敗にする。
//
// 下限は、決めた日の数字の少し下(0.2〜0.5 ポイント)。目的は、数字が「下がったら分かる」こと。
// テストを足して数字が上がったら、下限も上げる(下げるときは、理由を PR に書く)。
//
// 2026-11-25 に決定(PR #49 のマージ時の合算の数字):
//   全体        文 92.31% / 分岐 91.35% / 関数 87.50%  → 92 / 91 / 87
//   lib/domain  文 98.20% / 分岐 96.15% / 関数 98.94%  → 98 / 96 / 98(規則の中心なので、別に守る)
// lib/server/queries(文 63.99%)には、下限を付けない。画面を通す段階 D で埋まる見込みなので、そのとき決める。

import type { MergedSummary } from "./merge";

export type Metric = "statements" | "branches" | "functions";

export const METRIC_LABEL: Record<Metric, string> = {
  statements: "文",
  branches: "分岐",
  functions: "関数",
};

export type Floor = {
  name: string;
  // 対象のファイルのパスの先頭。空なら、すべて。
  prefix: string;
  min: Record<Metric, number>;
};

export const FLOORS: readonly Floor[] = [
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
];

const METRICS: readonly Metric[] = ["statements", "branches", "functions"];

export type AreaResult = {
  name: string;
  fileCount: number;
  counts: Record<Metric, { covered: number; total: number }>;
};

export function summarizeArea(
  merged: MergedSummary,
  name: string,
  prefix: string,
): AreaResult {
  const counts = {
    statements: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
  };
  let fileCount = 0;
  for (const [file, s] of Object.entries(merged.files)) {
    if (!file.startsWith(prefix)) continue;
    fileCount++;
    for (const m of METRICS) {
      counts[m].covered += s[m].covered;
      counts[m].total += s[m].total;
    }
  }
  return { name, fileCount, counts };
}

// 下回ったものの説明を返す。空なら、すべて満たしている。
// 比べるときは、割り算の丸めを避けるため、covered * 100 < min * total の整数で比べる。
export function checkFloors(
  merged: MergedSummary,
  floors: readonly Floor[] = FLOORS,
): string[] {
  const problems: string[] = [];
  for (const floor of floors) {
    const area = summarizeArea(merged, floor.name, floor.prefix);
    if (area.fileCount === 0) {
      // パスの変更などで対象が空になると、何も測らずに通ってしまう。それを防ぐ。
      problems.push(
        `${floor.name}: 対象のファイルが 0 件です(${floor.prefix || "すべて"} に一致するファイルがない)`,
      );
      continue;
    }
    for (const m of METRICS) {
      const { covered, total } = area.counts[m];
      // 分母が 0 の指標は、0 < 0 で偽になり、失敗にならない(別に飛ばす必要はない)。
      if (covered * 100 < floor.min[m] * total) {
        problems.push(
          `${floor.name}の${METRIC_LABEL[m]}が下限を下回っています: ${(Math.round((covered / total) * 10000) / 100).toFixed(2)}% (${covered}/${total}) < ${floor.min[m]}%`,
        );
      }
    }
  }
  return problems;
}
