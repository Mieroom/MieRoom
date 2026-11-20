import { z } from "zod";

// テストケース台帳の 1 件。正本はこのリポジトリにある(Notion は経緯の記録)。
// 実際の結果は、ここには書かない。テストの実行結果から、機械が作る。
export const caseSchema = z
  .object({
    /** テスト名の先頭と同じ ID(例: T-APR-004、T-APR-023a) */
    id: z.string().regex(/^T-[A-Z]+-\d{3}[a-z]?$/),
    /** 何を確かめるか */
    title: z.string().min(1),
    /** 根拠(外部設計書の規則・メッセージ・画面、テスト設計書の節) */
    refs: z.array(z.string().min(1)).min(1),
    priority: z.enum(["高", "中", "低"]),
    kind: z.enum(["結合", "総合", "手動"]),
    precondition: z.string().min(1),
    /** 入力・操作(手動は手順) */
    input: z.string().min(1),
    expected: z.string().min(1),
    specStatus: z.enum(["確定", "条件付き", "保留"]),
    /** 書いた人とは別の人が、仕様と照らして確かめた記録。まだなら null */
    review: z.object({ by: z.string().min(1), at: z.iso.date() }).nullable(),
    /** 結びつく GitHub Issue の番号 */
    issues: z.array(z.number().int().positive()).default([]),
  })
  .strict();

export type TestCase = z.infer<typeof caseSchema>;

/** 台帳を検証して返す。形の違いと、ID の重複は、ここで止める。 */
export function defineCases(cases: z.input<typeof caseSchema>[]): TestCase[] {
  const parsed = z.array(caseSchema).parse(cases);
  const seen = new Set<string>();
  for (const item of parsed) {
    if (seen.has(item.id)) throw new Error(`台帳の ID が重複: ${item.id}`);
    seen.add(item.id);
  }
  return parsed;
}
