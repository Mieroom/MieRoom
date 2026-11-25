import { defineConfig } from "vitest/config";

// 結合テスト (tests/integration): the real handlers and server functions on a real PostgreSQL.
// `npm test` does not run these (their files end in .it.ts). Run: npm run test:integration
// The database is TEST_DATABASE_URL only (CI: a throw-away PostgreSQL; on a PC: a Neon
// database named *_test). tests/integration/support/guard.ts refuses anything else.
process.env.TZ = "UTC";
try {
  // Not committed (.env* is ignored). Holds TEST_DATABASE_URL for a PC.
  process.loadEnvFile(".env.integration");
} catch {
  // CI: the value comes from the real environment.
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    // 測る範囲(テスト方針 段階 C): 規則の関数(lib/domain)、権限・DB・操作の中身(lib/server)、入り口(app 以下の route.ts)。
    // route.ts は薄い入り口なので、lib/server を入れた(2026-11-25 に決定)。単体と結合は、npm run coverage:merge で合算する。
    // 基準の数字は、現状の数字を見てから決める(いまは、測るだけで、失敗にしない)。
    coverage: {
      provider: "v8",
      include: ["lib/domain/**/*.ts", "lib/server/**/*.ts", "app/**/route.ts"],
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage/integration",
    },
    include: ["tests/integration/**/*.it.ts"],
    globalSetup: ["tests/integration/support/global-setup.ts"],
    // One database: files run one after another, and each test starts from an empty one.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
