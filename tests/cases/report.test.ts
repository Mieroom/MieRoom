import { describe, expect, it } from "vitest";
import {
  buildRows,
  extractResults,
  jst,
  summarize,
  toCsv,
  type RunFile,
  type VitestReport,
} from "../../scripts/cases/lib";
import { defineCases } from "./schema";

// 結果の取り出し・報告書の行・CSV の作りを、小さな例で確かめる(scripts/cases/lib.ts)。

const CASES = defineCases([
  {
    id: "T-APR-001",
    title: "承認できる",
    refs: ["R4-7"],
    priority: "高",
    kind: "結合",
    precondition: "標準の予約",
    input: "承認を送る",
    expected: "200 と MI201",
    specStatus: "確定",
    review: null,
  },
  {
    id: "T-APR-002",
    title: "=SUM(1) で始まる題名",
    refs: ["R4-7"],
    priority: "中",
    kind: "結合",
    precondition: '引用符 " を含む前提',
    input: "却下を送る",
    expected: "200 と MI202",
    specStatus: "確定",
    review: { by: "確認者", at: "2026-11-19" },
    issues: [12],
  },
  {
    id: "T-APR-019",
    title: "手動の確認",
    refs: ["MC101"],
    priority: "中",
    kind: "手動",
    precondition: "学生でログイン",
    input: "取り下げを押す",
    expected: "MC101 の文言",
    specStatus: "確定",
    review: null,
  },
]);
const KNOWN = new Set(CASES.map((item) => item.id));

const report = (
  tests: { title: string; status: string; duration?: number; msg?: string[] }[],
): VitestReport => ({
  startTime: Date.UTC(2026, 10, 19, 2, 30, 0), // 日本時間 11:30
  testResults: [
    {
      name: "a.it.ts",
      assertionResults: tests.map((t) => ({
        title: t.title,
        status: t.status,
        duration: t.duration,
        failureMessages: t.msg,
      })),
    },
  ],
});

describe("結果の取り出し(extractResults)", () => {
  it("テスト名の先頭の ID で結びつけ、台帳にない ID や ID のないテストは捨てる", () => {
    const results = extractResults(
      report([
        { title: "T-APR-001 承認できる", status: "passed", duration: 12.6 },
        { title: "T-RSV-001 台帳にない", status: "passed" },
        { title: "ID のないテスト", status: "passed" },
        { title: "説明のなかに T-APR-002 がある", status: "passed" },
      ]),
      KNOWN,
    );
    expect(results).toEqual([
      { id: "T-APR-001", status: "passed", durationMs: 13 },
    ]);
  });

  it("T-APR-001 と T-APR-001x のように、似た ID を取り違えない", () => {
    const results = extractResults(
      report([{ title: "T-APR-0019 長すぎる ID", status: "passed" }]),
      KNOWN,
    );
    expect(results).toEqual([]);
  });

  it("失敗は、メッセージの先頭の 1 行だけを、短くして残す", () => {
    const long = "x".repeat(500);
    const [result] = extractResults(
      report([
        {
          title: "T-APR-001 承認できる",
          status: "failed",
          msg: [`AssertionError: ${long}\n    at line 1\n    at line 2`],
        },
      ]),
      KNOWN,
    );
    expect(result.status).toBe("failed");
    expect(result.failure?.startsWith("AssertionError: xxx")).toBe(true);
    expect(result.failure?.length).toBe(301); // 300 文字 + …
    expect(result.failure).not.toContain("at line");
  });

  it("同じ ID のテストが複数あれば 1 つにまとめる(1 つでも失敗なら失敗。時間は足す)", () => {
    const results = extractResults(
      report([
        { title: "T-APR-001 一つ目", status: "passed", duration: 100 },
        {
          title: "T-APR-001 二つ目",
          status: "failed",
          duration: 50,
          msg: ["NG"],
        },
      ]),
      KNOWN,
    );
    expect(results).toEqual([
      { id: "T-APR-001", status: "failed", durationMs: 150, failure: "NG" },
    ]);
  });
});

describe("日本時間(jst)", () => {
  it("UTC 02:30 は、日本時間 11:30", () => {
    expect(jst(Date.UTC(2026, 10, 19, 2, 30, 0))).toBe(
      "2026-11-19T11:30:00+09:00",
    );
  });
  it("UTC 15:00 は、日本時間では翌日の 0:00(日付の境目)", () => {
    expect(jst(Date.UTC(2026, 10, 19, 15, 0, 0))).toBe(
      "2026-11-20T00:00:00+09:00",
    );
  });
});

const RUN: RunFile = {
  run: {
    at: "2026-11-19T11:30:00+09:00",
    commit: "912be57",
    dirty: false,
    where: "local",
    suite: "integration",
    tool: "vitest 5.0.5",
  },
  results: [
    { id: "T-APR-001", status: "passed", durationMs: 13 },
    { id: "T-APR-002", status: "failed", durationMs: 7, failure: "NG" },
  ],
};

describe("報告書の行(buildRows)と集計(summarize)", () => {
  it("台帳の全ケースが 1 行ずつ。結果のないケース(手動など)は「未実施」", () => {
    const rows = buildRows(CASES, RUN);
    expect(rows).toHaveLength(3);
    const resultColumn = 11; // 台帳の 11 列のあとが「結果」
    expect(rows.map((row) => row[resultColumn])).toEqual([
      "合格",
      "失敗",
      "未実施",
    ]);
    expect(rows[0].slice(resultColumn + 1)).toEqual([
      "2026-11-19T11:30:00+09:00",
      "912be57",
      "手元",
      "13",
      "",
    ]);
    expect(rows[1][resultColumn + 5]).toBe("NG");
    expect(rows[2].slice(resultColumn + 1)).toEqual(["", "", "", "", ""]);
  });

  it("レビュー・Issue の欄: 未レビューと、確認者と日付、#番号", () => {
    const rows = buildRows(CASES, RUN);
    expect(rows[0][9]).toBe("未レビュー");
    expect(rows[1][9]).toBe("確認者 2026-11-19");
    expect(rows[1][10]).toBe("#12");
  });

  it("コミット前の変更があった実行は、コミット欄に印が付く", () => {
    const rows = buildRows(CASES, { ...RUN, run: { ...RUN.run, dirty: true } });
    expect(rows[0][13]).toBe("912be57(コミット前)");
  });

  it("結果のファイルがなければ、すべて未実施", () => {
    expect(summarize(CASES, null)).toEqual({
      合格: 0,
      失敗: 0,
      スキップ: 0,
      既知の不具合: 0,
      未実施: 3,
    });
    expect(summarize(CASES, RUN)).toEqual({
      合格: 1,
      失敗: 1,
      スキップ: 0,
      既知の不具合: 0,
      未実施: 1,
    });
  });

  it("既知の不具合は、結果の欄に「既知の不具合」、失敗のメッセージの欄に Issue の番号が出る。集計は別に数える", () => {
    const known: RunFile = {
      ...RUN,
      results: [
        { id: "T-APR-001", status: "known-defect", durationMs: 5, issue: 34 },
        { id: "T-APR-002", status: "passed", durationMs: 7 },
      ],
    };
    const rows = buildRows(CASES, known);
    expect(rows[0][11]).toBe("既知の不具合");
    expect(rows[0][16]).toContain("#34");
    expect(rows[1][11]).toBe("合格");
    expect(summarize(CASES, known)).toEqual({
      合格: 1,
      失敗: 0,
      スキップ: 0,
      既知の不具合: 1,
      未実施: 1,
    });
  });
});

describe("既知の不具合の印(案 A: it.fails と Issue の番号)", () => {
  it("印([既知 #番号])があって、報告が「合格」(it.fails が期待どおり失敗した)なら、既知の不具合。Issue の番号を残す", () => {
    const results = extractResults(
      report([
        {
          title: "T-APR-001 [既知 #34] 承認できる",
          status: "passed",
          duration: 5,
        },
      ]),
      KNOWN,
    );
    expect(results).toEqual([
      { id: "T-APR-001", status: "known-defect", durationMs: 5, issue: 34 },
    ]);
  });

  it("印があるのに、報告が「失敗」(it.fails なのに、期待どおりに通ってしまった = 直った可能性)なら、失敗として残す", () => {
    const results = extractResults(
      report([
        {
          title: "T-APR-001 [既知 #34] 承認できる",
          status: "failed",
          duration: 5,
          msg: ["Error: Expect test to fail"],
        },
      ]),
      KNOWN,
    );
    expect(results).toEqual([
      {
        id: "T-APR-001",
        status: "failed",
        durationMs: 5,
        failure: "Error: Expect test to fail",
      },
    ]);
  });

  it("印がなければ、「合格」は合格のまま(既知の不具合にしない)", () => {
    const [result] = extractResults(
      report([{ title: "T-APR-001 承認できる", status: "passed" }]),
      KNOWN,
    );
    expect(result.status).toBe("passed");
  });

  it("同じ ID に、既知の不具合と合格が混ざれば、失敗でない中では、既知の不具合を優先して残す", () => {
    const [result] = extractResults(
      report([
        { title: "T-APR-001 一つ目", status: "passed", duration: 1 },
        { title: "T-APR-001 [既知 #34] 二つ目", status: "passed", duration: 1 },
      ]),
      KNOWN,
    );
    expect(result.status).toBe("known-defect");
    expect(result.issue).toBe(34);
  });
});

describe("CSV(toCsv)", () => {
  it("BOM つき UTF-8 で、改行は CRLF。引用符は 2 つにする", () => {
    const csv = toCsv(buildRows(CASES, RUN));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(5); // 見出し + 3 行 + 末尾の空
    expect(csv).toContain('"引用符 "" を含む前提"');
  });

  it("先頭が = + - @ の値は、数式として動かないように ' を付ける", () => {
    const csv = toCsv([["=SUM(1)", "+1", "-1", "@a", "ふつう"]]);
    const line = csv.split("\r\n")[1];
    expect(line).toBe(`"'=SUM(1)","'+1","'-1","'@a","ふつう"`);
  });
});
