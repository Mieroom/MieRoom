import { z } from "zod";
import type { TestCase } from "../../tests/cases/schema";

// テストケース台帳 (tests/cases) と、テストの実行結果 (vitest の JSON 報告) を結びつける。
// 結果は手で書かない。実行のたびに、1 回分のファイルを作る(上書きして履歴を消さない)。

export const vitestReportSchema = z.object({
  startTime: z.number(),
  testResults: z.array(
    z.object({
      name: z.string(),
      assertionResults: z.array(
        z.object({
          title: z.string(),
          status: z.string(),
          duration: z.number().nullable().optional(),
          failureMessages: z.array(z.string()).optional(),
        }),
      ),
    }),
  ),
});
export type VitestReport = z.infer<typeof vitestReportSchema>;

export const runFileSchema = z.object({
  run: z.object({
    at: z.string(),
    commit: z.string(),
    /** 結果に関わるファイルに、コミットしていない変更があった */
    dirty: z.boolean(),
    where: z.enum(["local", "ci"]),
    suite: z.string(),
    tool: z.string(),
  }),
  results: z.array(
    z.object({
      id: z.string(),
      /** known-defect: 既知の不具合(Issue がある。テストは、失敗を期待する印 it.fails つき) */
      status: z.enum(["passed", "failed", "skipped", "known-defect"]),
      durationMs: z.number(),
      failure: z.string().optional(),
      /** known-defect のときの、GitHub Issue の番号 */
      issue: z.number().int().positive().optional(),
    }),
  ),
});
export type RunFile = z.infer<typeof runFileSchema>;
export type CaseResult = RunFile["results"][number];

const LEADING_ID = /^(T-[A-Z]+-\d{3}[a-z]?)(?![\w])/;
const FAILURE_MAX = 300;

/** 失敗のメッセージは、先頭の 1 行だけを、短くして残す(スタックや長い差分は残さない)。 */
function firstLine(messages: string[] | undefined): string | undefined {
  const text = messages?.find((m) => m.trim() !== "");
  if (text === undefined) return undefined;
  const line = text.trim().split(/\r?\n/)[0];
  return line.length > FAILURE_MAX ? `${line.slice(0, FAILURE_MAX)}…` : line;
}

const toStatus = (status: string): CaseResult["status"] =>
  status === "passed" ? "passed" : status === "failed" ? "failed" : "skipped";

const RANK = { passed: 0, "known-defect": 1, skipped: 2, failed: 3 } as const;

/**
 * 既知の不具合の印: テスト名の `[既知 #34]`。期待どおりに書いたテストが、実装の不具合で失敗する間は、
 * `it.fails`(失敗を期待する)にして、この印と Issue の番号を付ける(案 A)。`it.fails` のテストは、
 * 失敗したとき「合格」と報告されるので、印があれば「既知の不具合」と読み替える。直って、期待どおりに
 * 通るようになると、`it.fails` のテストが失敗として報告されるので、印を外すことに気づける。
 */
const KNOWN_DEFECT = /\[既知 #(\d+)\]/;

/**
 * vitest の報告から、台帳にある ID のテストだけを取り出す。テスト名の先頭の ID で結びつける。
 * 同じ ID のテストが複数あるときは、1 つにまとめる(1 つでも失敗なら失敗)。
 */
export function extractResults(
  report: VitestReport,
  knownIds: ReadonlySet<string>,
): CaseResult[] {
  const byId = new Map<string, CaseResult>();
  for (const file of report.testResults) {
    for (const test of file.assertionResults) {
      const id = LEADING_ID.exec(test.title)?.[1];
      if (id === undefined || !knownIds.has(id)) continue;
      const marked = KNOWN_DEFECT.exec(test.title)?.[1];
      const status =
        marked !== undefined && test.status === "passed"
          ? "known-defect"
          : toStatus(test.status);
      const found: CaseResult = {
        id,
        status,
        durationMs: Math.round(test.duration ?? 0),
        ...(status === "failed"
          ? { failure: firstLine(test.failureMessages) }
          : {}),
        ...(status === "known-defect" ? { issue: Number(marked) } : {}),
      };
      const before = byId.get(id);
      if (before === undefined) {
        byId.set(id, found);
        continue;
      }
      const worse = RANK[found.status] > RANK[before.status] ? found : before;
      byId.set(id, {
        ...worse,
        durationMs: before.durationMs + found.durationMs,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** 日本時間の日時(例: 2026-11-19T11:30:00+09:00)。 */
export function jst(ms: number): string {
  return `${new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 19)}+09:00`;
}

const STATUS_TEXT = {
  passed: "合格",
  failed: "失敗",
  skipped: "スキップ",
  "known-defect": "既知の不具合",
} as const;

const COLUMNS = [
  { header: "ID", pick: (c: TestCase) => c.id },
  { header: "区分", pick: (c: TestCase) => c.kind },
  { header: "優先度", pick: (c: TestCase) => c.priority },
  { header: "何を確かめるか", pick: (c: TestCase) => c.title },
  { header: "根拠", pick: (c: TestCase) => c.refs.join("、") },
  { header: "前提", pick: (c: TestCase) => c.precondition },
  { header: "入力・操作", pick: (c: TestCase) => c.input },
  { header: "期待する結果", pick: (c: TestCase) => c.expected },
  { header: "仕様の状態", pick: (c: TestCase) => c.specStatus },
  {
    header: "レビュー",
    pick: (c: TestCase) =>
      c.review === null ? "未レビュー" : `${c.review.by} ${c.review.at}`,
  },
  {
    header: "Issue",
    pick: (c: TestCase) => c.issues.map((n) => `#${n}`).join(" "),
  },
] as const;

export const REPORT_HEADERS = [
  ...COLUMNS.map((c) => c.header),
  "結果",
  "実行日時",
  "コミット",
  "実行した場所",
  "所要時間(ms)",
  "失敗のメッセージ",
] as const;

/** 台帳の全ケースを 1 行ずつ。結果のないケースは「未実施」。 */
export function buildRows(
  cases: readonly TestCase[],
  runFile: RunFile | null,
): string[][] {
  const results = new Map(runFile?.results.map((r) => [r.id, r]));
  return cases.map((item) => {
    const result = results.get(item.id);
    const where = runFile?.run.where === "ci" ? "CI" : "手元";
    return [
      ...COLUMNS.map((c) => c.pick(item)),
      result === undefined ? "未実施" : STATUS_TEXT[result.status],
      result === undefined || runFile === null ? "" : runFile.run.at,
      result === undefined || runFile === null
        ? ""
        : `${runFile.run.commit}${runFile.run.dirty ? "(コミット前)" : ""}`,
      result === undefined || runFile === null ? "" : where,
      result === undefined ? "" : String(result.durationMs),
      result?.status === "known-defect"
        ? `既知の不具合(Issue #${result.issue}。実装は、直す段階で直す)`
        : (result?.failure ?? ""),
    ];
  });
}

/** 表計算で、先頭の = + - @ が数式として動かないように、先頭に ' を付ける(T-SEC-010 と同じ考え方)。 */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** BOM つき UTF-8、改行は CRLF(Excel でそのまま開ける)。 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const lines = [REPORT_HEADERS as readonly string[], ...rows].map((row) =>
    row.map(cell).join(","),
  );
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function summarize(
  cases: readonly TestCase[],
  runFile: RunFile | null,
): Record<"合格" | "失敗" | "スキップ" | "既知の不具合" | "未実施", number> {
  const count = { 合格: 0, 失敗: 0, スキップ: 0, 既知の不具合: 0, 未実施: 0 };
  const results = new Map(runFile?.results.map((r) => [r.id, r.status]));
  for (const item of cases) {
    const status = results.get(item.id);
    if (status === undefined) count.未実施++;
    else count[STATUS_TEXT[status]]++;
  }
  return count;
}
