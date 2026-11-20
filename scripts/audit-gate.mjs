// `npm audit` の結果を読んで、高(high)以上の指摘が、例外の一覧にないものだけのときに通す。
//   node scripts/audit-gate.mjs
// 例外は、修正版がないなど、いま直せない指摘だけ。理由と、外す条件を書く (テスト方針 8 章の 3)。
// 例外に入れた指摘が出なくなったら、一覧から外すように知らせる (失敗にはしない)。
import { spawnSync } from "node:child_process";

/**
 * 例外の一覧。GHSA の ID → { package, reason }。いまは、ない。
 * 修正版がないなどで、いま直せない高以上の指摘が出たら、理由(と、外す条件)を書いて足す。
 */
const ALLOWED = {};

const FAIL_LEVELS = new Set(["high", "critical"]);

const run = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 1 << 26,
  shell: process.platform === "win32",
});
if (!run.stdout) {
  console.error("npm audit の結果が取れませんでした:\n" + (run.stderr || ""));
  process.exit(2);
}
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error(
    "npm audit の結果を読めませんでした:\n" + run.stdout.slice(0, 500),
  );
  process.exit(2);
}
if (report.error) {
  console.error("npm audit が失敗しました: " + JSON.stringify(report.error));
  process.exit(2);
}

// 指摘 (advisory) を、ID ごとに 1 つにまとめる
const advisories = new Map();
for (const [name, vulnerability] of Object.entries(
  report.vulnerabilities || {},
)) {
  for (const via of vulnerability.via || []) {
    if (typeof via !== "object" || via === null) continue;
    const match = /GHSA-[a-z0-9-]+/i.exec(via.url || "");
    const id = match ? match[0] : `source-${via.source}`;
    if (!advisories.has(id)) {
      advisories.set(id, {
        id,
        severity: via.severity,
        title: via.title,
        package: via.name || name,
      });
    }
  }
}

const blocking = [];
const allowed = [];
const others = [];
for (const advisory of advisories.values()) {
  if (!FAIL_LEVELS.has(advisory.severity)) others.push(advisory);
  else if (ALLOWED[advisory.id]) allowed.push(advisory);
  else blocking.push(advisory);
}

const line = (a) => `  ${a.id}  ${a.severity}  ${a.package}: ${a.title}`;
console.log(`npm audit: 指摘 ${advisories.size} 件`);
if (allowed.length > 0) {
  console.log("例外として通す(高以上):");
  for (const a of allowed) {
    console.log(line(a));
    console.log("    理由: " + ALLOWED[a.id].reason);
  }
}
if (others.length > 0) {
  console.log("高より低い指摘(通す。直せるときに直す):");
  for (const a of others) console.log(line(a));
}
const gone = Object.keys(ALLOWED).filter(
  (id) => !allowed.some((a) => a.id === id),
);
if (gone.length > 0) {
  console.log(
    "例外の一覧に入っているが、もう出ない指摘(一覧から外してよい): " +
      gone.join(", "),
  );
}
if (blocking.length > 0) {
  console.error("高以上の指摘があります(例外にない):");
  for (const a of blocking) console.error(line(a));
  process.exit(1);
}
console.log("高以上の指摘は、例外のものだけです。");
