// 単体と結合のカバレッジを合算して、表を出す(npm run coverage:merge)。
//
//   npm run test:coverage && npm run test:integration:coverage && npm run coverage:merge
//
// 読むのは、coverage/unit と coverage/integration の coverage-final.json。
// 書くのは、coverage/merged-summary.json と、標準出力の表(通っていない文が多いファイルの順)。
// 基準の数字による失敗は、まだ付けていない(現状の数字を見てから決める)。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { coverageFinalSchema, mergeCoverage, pct, type Counts } from "./merge";

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
}

main();
