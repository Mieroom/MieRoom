import { defineConfig } from "vitest/config";

// Run tests in UTC so that Japan-time bugs (deadlines, school year) show up.
// Set before workers start so they inherit it.
process.env.TZ = "UTC";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    // 測る範囲(テスト方針 段階 C): 規則の関数(lib/domain)、権限・DB・操作の中身(lib/server)、入り口(app 以下の route.ts)。
    // route.ts は薄い入り口なので、lib/server を入れた(2026-11-25 に決定)。単体と結合は、npm run coverage:merge で合算する。
    // 下限は、単体と結合の合算で判定する(scripts/coverage/floors.ts)。ここでは、測るだけ。
    coverage: {
      provider: "v8",
      include: ["lib/domain/**/*.ts", "lib/server/**/*.ts", "app/**/route.ts"],
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage/unit",
    },
  },
});
