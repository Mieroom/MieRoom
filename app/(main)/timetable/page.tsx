import {
  TimetableView,
  type TimetableMode,
} from "@/components/screens/timetable-view";
import {
  fiscalYearOfDate,
  isSchoolDate,
  monthOf,
  monthWeeks,
  parseWeekStart,
  schoolMinutes,
  schoolToday,
  type WeekStart,
} from "@/lib/domain/school-date";
import {
  listActiveTeachers,
  listClassesForYear,
} from "@/lib/server/queries/common";
import { loadTimetableDays } from "@/lib/server/queries/lessons";
import { hasRole, requireUser } from "@/lib/server/session";
import { one } from "@/lib/url";

function datesOf(
  mode: TimetableMode,
  date: string,
  start: WeekStart,
): string[] {
  if (mode === "day") return [date];
  // The weeks that hold the month: the calendar below xl also draws the days of the
  // previous and next months in its first and last rows.
  return monthWeeks(monthOf(date), start).flat();
}

// S03 時間割
export default async function TimetablePage({
  searchParams,
}: PageProps<"/timetable">) {
  const user = await requireUser();
  const params = await searchParams;
  const now = new Date();
  const today = schoolToday(now);
  const requestedDate = one(params.date);
  const date = isSchoolDate(requestedDate) ? requestedDate : today;
  // The month opens by default. view=day is one day in detail (a date of the month,
  // or ホームの「今日の時間割を見る」). An old view=week link shows the month.
  const mode: TimetableMode = one(params.view) === "day" ? "day" : "month";
  // 週の始まり。選んだ方はブラウザが覚えて、URL で送ってくる (week-start-memory.tsx)。
  const weekStart = parseWeekStart(one(params.start));

  const [classes, teachers] = await Promise.all([
    listClassesForYear(fiscalYearOfDate(date)),
    listActiveTeachers(),
  ]);
  const selectedTeacher =
    teachers.find((item) => item.id === one(params.teacher)) ?? null;
  const selectedClass = selectedTeacher
    ? null
    : (classes.find((item) => item.id === one(params.class)) ??
      classes[0] ??
      null);
  const days = await loadTimetableDays(datesOf(mode, date, weekStart), {
    classId: selectedClass?.id ?? null,
    teacherId: selectedTeacher?.id ?? null,
  });

  return (
    <TimetableView
      mode={mode}
      date={date}
      weekStart={weekStart}
      today={today}
      minutes={schoolMinutes(now)}
      days={days}
      classes={classes}
      selectedClassId={selectedClass?.id ?? null}
      todayFiscalYear={fiscalYearOfDate(today)}
      teachers={teachers}
      selectedTeacherId={selectedTeacher?.id ?? null}
      canChange={hasRole(user, "teacher")}
    />
  );
}
