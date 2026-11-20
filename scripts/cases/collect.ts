// vitest の JSON 報告から、「1 回の実行の結果」のファイルを作る(npm run cases:collect)。
//
//   npm run test:integration -- --reporter=json --outputFile=<報告のパス>
//   npm run cases:collect -- <報告のパス> [--suite integration]
//
// 台帳(tests/cases)にある ID のテストだけを残す。ファイルは tests/cases/results/ に、
// 日時とコミットを名前に入れて作る。すでにあるファイルは上書きしない(履歴を消さない)。
// コミットしていない変更があるときは、`dirty` の印が付く。節目の記録は、きれいな状態で行う。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ALL_CASES } from "../../tests/cases/index";
import {
  extractResults,
  jst,
  runFileSchema,
  vitestReportSchema,
  type RunFile,
} from "./lib";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tests", "cases", "results");

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function main() {
  const args = process.argv.slice(2);
  const suiteAt = args.indexOf("--suite");
  const suite = suiteAt >= 0 ? (args[suiteAt + 1] ?? "") : "integration";
  const reportPath = args.find(
    (arg, i) => !arg.startsWith("--") && args[i - 1] !== "--suite",
  );
  if (!reportPath || suite === "") {
    throw new Error(
      "使い方: npm run cases:collect -- <vitest の JSON 報告のパス> [--suite 名前]",
    );
  }

  const report = vitestReportSchema.parse(
    JSON.parse(readFileSync(path.resolve(ROOT, reportPath), "utf8")),
  );
  const known = new Set(ALL_CASES.map((item) => item.id));
  const results = extractResults(report, known);
  if (results.length === 0) {
    throw new Error("台帳にある ID のテストが、報告に 1 件もありません");
  }

  const commit = git("rev-parse", "--short", "HEAD");
  // 結果に関わるファイルだけを見る(CLAUDE.md などは、結果に関係しない)。
  const dirty =
    git(
      "status",
      "--porcelain",
      "--",
      "lib",
      "app",
      "components",
      "prisma",
      "tests",
      "package.json",
      "package-lock.json",
      "vitest.config.mts",
      "vitest.integration.config.mts",
      ":(exclude)tests/cases/results",
      ":(exclude)tests/cases/reports",
    ) !== "";
  const vitestVersion = (
    JSON.parse(
      readFileSync(
        path.join(ROOT, "node_modules", "vitest", "package.json"),
        "utf8",
      ),
    ) as { version: string }
  ).version;

  const runFile: RunFile = runFileSchema.parse({
    run: {
      at: jst(report.startTime),
      commit,
      dirty,
      where: process.env.CI ? "ci" : "local",
      suite,
      tool: `vitest ${vitestVersion}`,
    },
    results,
  });

  const stamp = runFile.run.at.slice(0, 16).replace("T", "_").replace(":", "");
  const name = `${stamp}_${commit}${dirty ? "_dirty" : ""}.json`;
  const target = path.join(OUT_DIR, name);
  if (existsSync(target))
    throw new Error(`すでにあります(上書きしない): ${name}`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(target, `${JSON.stringify(runFile, null, 2)}\n`, "utf8");

  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`作成: tests/cases/results/${name}`);
  console.log(
    `台帳の ID の結果: ${results.length} 件(失敗 ${failed} 件)。コミット ${commit}${dirty ? "(コミット前の変更あり)" : ""}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
