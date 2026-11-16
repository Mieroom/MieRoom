// 月表示 (S03) の表: 担任が配る紙の時間割と同じ並び (日付が横、1限〜4限が縦)。
// The part that is not layout: how the month is split into bands.

/** The last day of the first band: 1〜15日, then 16日〜末日. */
const FIRST_BAND_LAST_DAY = 15;

/** The days of one month in two bands, 1〜15日 and 16日〜末日. An empty band is left out. */
export function monthHalves<T extends { date: string }>(days: T[]): T[][] {
  const dayOf = (date: string) => Number(date.slice(8, 10));
  return [
    days.filter((day) => dayOf(day.date) <= FIRST_BAND_LAST_DAY),
    days.filter((day) => dayOf(day.date) > FIRST_BAND_LAST_DAY),
  ].filter((band) => band.length > 0);
}
