import { BLOCK_CASES } from "./room-block.cases";
import { RESERVATION_CASES } from "./reservation.cases";
import type { TestCase } from "./schema";

// 全分野のテストケース台帳。分野を足したら、ここに足す(照合・結果の記録・報告書は、これを読む)。
export const ALL_CASES: readonly TestCase[] = [
  ...RESERVATION_CASES,
  ...BLOCK_CASES,
];
