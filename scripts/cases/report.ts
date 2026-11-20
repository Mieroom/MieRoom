// 台帳と、1 回の実行の結果から、報告書(CSV)を作る(npm run cases:report)。
//
//   npm run cases:report                         いちばん新しい結果のファイル
//   npm run cases:report -- <結果のファイル名>   選んだ結果のファイル(tests/cases/results/ の中)
//
// 台帳の全ケースが 1 行ずつ。結果がないケース(手動、まだ実行していないもの)は「未実施」。
// 出力は tests/cases/reports/ (Git には入れない)。

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ALL_CASES } from "../../tests/cases/index";
import { buildRows, runFileSchema, summarize, toCsv } from "./lib";

const ROOT = process.cwd();
const RESULTS_DIR = path.join(ROOT, "tests", "cases", "results");
const REPORTS_DIR = path.join(ROOT, "tests", "cases", "reports");

function main() {
  const wanted = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const files = readdirSync(RESULTS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(
      "結果のファイルがありません。先に cases:collect を実行してください",
    );
  }
  const name = wanted ? path.basename(wanted) : files[files.length - 1];
  if (!files.includes(name))
    throw new Error(`結果のファイルが見つかりません: ${name}`);

  const runFile = runFileSchema.parse(
    JSON.parse(readFileSync(path.join(RESULTS_DIR, name), "utf8")),
  );
  const rows = buildRows(ALL_CASES, runFile);
  mkdirSync(REPORTS_DIR, { recursive: true });
  const target = path.join(REPORTS_DIR, name.replace(/\.json$/, ".csv"));
  writeFileSync(target, toCsv(rows), "utf8");

  const count = summarize(ALL_CASES, runFile);
  console.log(`作成: ${path.relative(ROOT, target)}`);
  console.log(
    `結果のファイル: ${name}(実行 ${runFile.run.at}、コミット ${runFile.run.commit}${runFile.run.dirty ? "・コミット前の変更あり" : ""})`,
  );
  console.log(
    `台帳 ${ALL_CASES.length} 件: 合格 ${count.合格}、失敗 ${count.失敗}、スキップ ${count.スキップ}、未実施 ${count.未実施}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
