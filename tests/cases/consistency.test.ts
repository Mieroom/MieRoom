import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVATION_CASES } from "./reservation.cases";
import type { TestCase } from "./schema";

// 台帳(tests/cases/*.cases.ts)と、結合テスト(tests/integration/*.it.ts)が、ずれていないか。
// 台帳に書いたのにテストがない、テストを足したのに台帳にない、を、CI の `npm test` で止める。
//
// 拾い方(制限): テスト名の先頭の ID は `it("T-APR-001 …")` の形から、ループで作る名前は
// `id: "T-APR-022"` の形から、文字列として拾う。1 つの名前に ID が複数あるとき(例: T-RSV-002/003)は、
// 先頭の 1 つだけ。台帳が扱う分野(台帳に 1 件でもある分野。いまは T-APR と T-IMP)のテストだけを調べる。
// 分野を広げるときは、その分野のケースを台帳に足す。足すまでは、その分野は調べない。

const CASES: TestCase[] = [...RESERVATION_CASES];
const INTEGRATION_DIR = path.join(process.cwd(), "tests", "integration");

const ID = "T-[A-Z]+-\\d{3}[a-z]?";
const FROM_TEST_NAME = new RegExp(`\\bit\\(\\s*[\`"'](${ID})(?![\\w])`, "g");
const FROM_TABLE = new RegExp(`\\bid:\\s*"(${ID})"`, "g");
const area = (id: string) => id.replace(/-\d{3}[a-z]?$/, "");

function idsInIntegrationTests(): Set<string> {
  const ids = new Set<string>();
  for (const name of readdirSync(INTEGRATION_DIR)) {
    if (!name.endsWith(".it.ts")) continue;
    const source = readFileSync(path.join(INTEGRATION_DIR, name), "utf8");
    for (const pattern of [FROM_TEST_NAME, FROM_TABLE]) {
      for (const match of source.matchAll(pattern)) ids.add(match[1]);
    }
  }
  return ids;
}

describe("テストケース台帳と結合テストの照合", () => {
  const inTests = idsInIntegrationTests();

  it("結合テストの名前から、ID を拾えている(拾い方の確認)", () => {
    expect(inTests.has("T-APR-001")).toBe(true); // it("T-APR-001 …") の形
    expect(inTests.has("T-APR-022")).toBe(true); // ループの表 id: "T-APR-022" の形
  });

  it("台帳の ID は、重複していない", () => {
    const ids = CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("台帳の「結合」のケースは、どれも、結合テストの名前にある", () => {
    const missing = CASES.filter(
      (item) => item.kind === "結合" && !inTests.has(item.id),
    ).map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it("台帳の「手動」のケースは、結合テストの名前にない(自動と手動を二重にしない)", () => {
    const doubled = CASES.filter(
      (item) => item.kind === "手動" && inTests.has(item.id),
    ).map((item) => item.id);
    expect(doubled).toEqual([]);
  });

  it("台帳が扱う分野の結合テストは、どれも、台帳にある", () => {
    const areas = new Set(CASES.map((item) => area(item.id)));
    const known = new Set(CASES.map((item) => item.id));
    const missing = [...inTests]
      .filter((id) => areas.has(area(id)) && !known.has(id))
      .sort();
    expect(missing).toEqual([]);
  });
});
