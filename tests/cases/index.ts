import { LINK_CLOSURE_CASES } from "./links-closures.cases";
import { MASTER_CASES } from "./masters.cases";
import { BLOCK_CASES } from "./room-block.cases";
import { RESERVATION_CASES } from "./reservation.cases";
import type { TestCase } from "./schema";
import { TIMETABLE_IMPORT_CASES } from "./timetable-import.cases";
import { TIMETABLE_IMPORT_2_CASES } from "./timetable-import-2.cases";

// 全分野のテストケース台帳。分野を足したら、ここに足す(照合・結果の記録・報告書は、これを読む)。
export const ALL_CASES: readonly TestCase[] = [
  ...RESERVATION_CASES,
  ...BLOCK_CASES,
  ...TIMETABLE_IMPORT_CASES,
  ...TIMETABLE_IMPORT_2_CASES,
  ...MASTER_CASES,
  ...LINK_CLOSURE_CASES,
];
