import { HomeView } from "@/components/screens/home-view";
import { closureNamesOn } from "@/lib/domain/closures";
import {
  fiscalYearOfDate,
  schoolMinutes,
  schoolToday,
} from "@/lib/domain/school-date";
import {
  listClassesForYear,
  listClosuresForClass,
} from "@/lib/server/queries/common";
import {
  loadHomeLessons,
  loadTimetableDays,
} from "@/lib/server/queries/lessons";
import { requireUser } from "@/lib/server/session";
import { one } from "@/lib/url";

// S02 ホーム
export default async function HomePage({ searchParams }: PageProps<"/">) {
  await requireUser();
  const params = await searchParams;
  const now = new Date();
  const today = schoolToday(now);
  const minutes = schoolMinutes(now);
  const year = fiscalYearOfDate(today);
  const classes = await listClassesForYear(year);
  const requested = one(params.class);
  const selected = classes.find((item) => item.id === requested) ?? null;
  const [closures, lessons, todayDays] = await Promise.all([
    listClosuresForClass(today, today, selected?.id ?? null),
    selected
      ? loadHomeLessons(selected.id, today, minutes)
      : ({ kind: "undecided" } as const),
    // 今日の時間割: the same days as S03's day view, for the chosen class only.
    selected
      ? loadTimetableDays([today], { classId: selected.id, teacherId: null })
      : [],
  ]);

  return (
    <HomeView
      today={today}
      classes={classes}
      selectedClassId={selected?.id ?? null}
      todayFiscalYear={year}
      yearChanged={one(params.notice) === "year-changed"}
      lessons={lessons}
      closures={closureNamesOn(today, closures)}
      minutes={minutes}
      todayTimetable={todayDays[0] ?? null}
    />
  );
}
