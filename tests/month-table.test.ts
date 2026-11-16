import { describe, expect, it } from "vitest";
import { monthHalves } from "@/lib/domain/month-table";

const novemberDays = Array.from({ length: 30 }, (_, index) => ({
  date: `2026-11-${String(index + 1).padStart(2, "0")}`,
}));

describe("月表示の表: 前半・後半の2段", () => {
  it("1〜15日と16日〜末日に分ける", () => {
    const [first, second] = monthHalves(novemberDays);
    expect(first.map((day) => day.date)).toEqual(
      novemberDays.slice(0, 15).map((day) => day.date),
    );
    expect(second[0].date).toBe("2026-11-16");
    expect(second.at(-1)?.date).toBe("2026-11-30");
  });

  it("15日と16日が境目。31日の月も、2月も2段", () => {
    const days = (month: string, last: number) =>
      Array.from({ length: last }, (_, index) => ({
        date: `${month}-${String(index + 1).padStart(2, "0")}`,
      }));
    const december = monthHalves(days("2026-12", 31));
    expect(december[0].at(-1)?.date).toBe("2026-12-15");
    expect(december[1]).toHaveLength(16);
    const february = monthHalves(days("2027-02", 28));
    expect(february[1]).toHaveLength(13);
  });

  it("空の段は出さない", () => {
    expect(monthHalves([{ date: "2026-11-20" }])).toEqual([
      [{ date: "2026-11-20" }],
    ]);
    expect(monthHalves([])).toEqual([]);
  });
});
