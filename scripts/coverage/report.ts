// 単体と結合のカバレッジを合算して、表を出す(npm run coverage:merge)。
//
//   npm run test:coverage && npm run test:integration:coverage && npm run coverage:merge
//
// 読むのは、coverage/unit と coverage/integration の coverage-final.json。
// 書くのは、coverage/merged-summary.json と、標準出力の表(通っていない文が多いファイルの順)。
// 下限(floors.ts)を下回ったら、終了コード 1 で失敗にする。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  FLOORS,
  METRIC_LABEL,
  checkFloors,
  summarizeArea,
  type Metric,
} from "./floors";
import { coverageFinalSchema, mergeCoverage, pct, type Counts } from "./merge";

const METRICS: readonly Metric[] = ["statements", "branches", "functions"];

const ROOT = process.cwd();
const INPUTS = ["coverage/unit", "coverage/integration"];

function main() {
  const runs = INPUTS.map((dir) => {
    const file = path.join(ROOT, dir, "coverage-final.json");
    if (!existsSync(file)) {
      throw new Error(
        `${dir}/coverage-final.json がありません。先に npm run test:coverage と npm run test:integration:coverage を実行してください`,
      );
    }
    return coverageFinalSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  });

  const merged = mergeCoverage(runs);
  writeFileSync(
    path.join(ROOT, "coverage", "merged-summary.json"),
    JSON.stringify(merged, null, 2) + "\n",
  );

  const show = (label: string, c: Counts) =>
    `${label}: ${pct(c)}% (${c.covered}/${c.total})`;
  console.log("合算(単体 + 結合)");
  console.log(show("  文  ", merged.total.statements));
  console.log(show("  分岐", merged.total.branches));
  console.log(show("  関数", merged.total.functions));

  const rows = Object.entries(merged.files)
    .map(([file, s]) => ({
      file,
      missing: s.statements.total - s.statements.covered,
      s,
    }))
    .filter((r) => r.missing > 0 || r.s.branches.covered < r.s.branches.total)
    .sort((a, b) => b.missing - a.missing);
  console.log("\n通っていない文・分岐があるファイル(文の多い順)");
  for (const r of rows) {
    console.log(
      `  ${r.file.padEnd(54)} 文 ${String(pct(r.s.statements)).padStart(6)}%  分岐 ${String(pct(r.s.branches)).padStart(6)}%  未通過の文 ${r.missing}`,
    );
  }

  console.log("\n下限(scripts/coverage/floors.ts)");
  for (const floor of FLOORS) {
    const a = summarizeArea(merged, floor.name, floor.prefix);
    const cells = METRICS.map(
      (m) => `${METRIC_LABEL[m]} ${pct(a.counts[m])}% (下限 ${floor.min[m]}%)`,
    );
    console.log(
      `  ${floor.name.padEnd(12)} ${a.fileCount} ファイル  ${cells.join("  ")}`,
    );
  }
  const problems = checkFloors(merged);
  if (problems.length > 0) {
    console.log("\n下限を下回っています");
    for (const p of problems) console.log(`  ${p}`);
    process.exitCode = 1;
  } else {
    console.log("\nすべての下限を満たしています");
  }
}

main();
