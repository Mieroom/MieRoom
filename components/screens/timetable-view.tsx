import Form from "next/form";
import Link from "next/link";
import {
  MyClassSelect,
  type ClassOption,
} from "@/components/shell/my-class-select";
import { AutoSubmitInput, AutoSubmitSelect } from "@/components/ui/auto-submit";
import { LinkButton } from "@/components/ui/button";
import { filterFieldClass, filterSelectClass } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import {
  Badge,
  Callout,
  Card,
  EmptyState,
  FilterBar,
  PageHeading,
  Segmented,
  TableWrap,
  Td,
  Th,
} from "@/components/ui/parts";
import { monthHalves } from "@/lib/domain/month-table";
import { PERIODS } from "@/lib/domain/periods";
import {
  addDays,
  addMonths,
  formatDate,
  formatLongDate,
  formatMonth,
  monthOf,
  weekdayHeaders,
  weekdayOf,
  weekStartOf,
  type WeekStart,
} from "@/lib/domain/school-date";
import { withQuery } from "@/lib/url";
import {
  isRunning,
  LessonBadges,
  roomText,
  teacherText,
  type LessonView,
  type TimetableDay,
} from "./lesson-parts";
import { WeekStartMemory } from "./week-start-memory";

export type TimetableMode = "day" | "week" | "month";

const WEEKDAY_NAMES = weekdayHeaders("sun");

function DayView({
  day,
  today,
  minutes,
  canChange,
  changeBasePath,
  addHref,
}: {
  day: TimetableDay;
  today: string;
  minutes: number;
  canChange: boolean;
  changeBasePath: string;
  addHref: string | null;
}) {
  if (!day.entered) {
    return (
      <EmptyState title="この日の時間割は未定です">
        担任の時間割が取り込まれると、ここに出ます。「授業なし」という意味ではありません。
      </EmptyState>
    );
  }
  const changeable = canChange && day.date >= today;
  // The page caps the lesson list at max-w-4xl (see TimetableView): on wide screens
  // the room stays close to its lesson.
  return (
    <div className="flex flex-col gap-2.5">
      {PERIODS.map((period) => {
        const lessons = day.lessons.filter(
          (lesson) => lesson.periodNo === period.no,
        );
        const running = isRunning(period.no, day.date, today, minutes);
        return (
          <Card
            key={period.no}
            className={`grid grid-cols-[60px_minmax(0,1fr)_64px] items-center gap-3 px-3 py-4 sm:grid-cols-[96px_minmax(0,1fr)_140px] sm:gap-4 sm:px-6 sm:py-5 ${
              running ? "border-[#5d6ee1] bg-[#f2f5ff]" : ""
            }`}
          >
            <div className="text-xs font-bold text-[#4a576c]">
              {period.label}
              <small className="mt-0.5 block text-[11px] font-normal text-muted">
                {period.start}-{period.end}
              </small>
            </div>
            <div className="min-w-0">
              {lessons.length === 0 ? (
                <span className="text-xs text-muted">授業なし</span>
              ) : (
                lessons.map((lesson) => (
                  <LessonLine
                    key={lesson.id}
                    lesson={lesson}
                    running={running}
                    changeable={changeable}
                    changeBasePath={changeBasePath}
                  />
                ))
              )}
            </div>
            <div className="text-right">
              {lessons.map((lesson) => (
                <div
                  key={lesson.id}
                  className={`text-[19px] font-bold text-navy sm:text-[22px] ${
                    lesson.cancelled ? "text-muted line-through" : ""
                  }`}
                >
                  {roomText(lesson.room)}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      {changeable && addHref && (
        <div className="print:hidden">
          <LinkButton href={addHref}>
            <Icon name="plus" size={15} />
            授業を足す(補講)
          </LinkButton>
        </div>
      )}
    </div>
  );
}

function LessonLine({
  lesson,
  running,
  changeable,
  changeBasePath,
}: {
  lesson: LessonView;
  running: boolean;
  changeable: boolean;
  changeBasePath: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`text-[13px] font-bold sm:text-base ${
            lesson.cancelled ? "text-muted line-through" : ""
          }`}
        >
          {lesson.subject}
        </span>
        {running && !lesson.cancelled && <Badge kind="busy">いま</Badge>}
        <LessonBadges lesson={lesson} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        {lesson.className && <span>{lesson.className}</span>}
        <span>{teacherText(lesson.teachers)}</span>
        {changeable && (
          <LinkButton
            size="sm"
            href={`${changeBasePath}/${lesson.id}`}
            className="print:hidden"
          >
            <Icon name="edit" size={13} />
            変更
          </LinkButton>
        )}
      </div>
    </div>
  );
}

// Below lg (phones, and tablets where the sidebar leaves about 512px) the week is a list
// of days, each with compact lesson rows. From lg it is a table; the table is also what
// is printed.
function WeekView({ days, today }: { days: TimetableDay[]; today: string }) {
  return (
    <>
      <WeekList days={days} today={today} />
      {/* table-fixed with a fixed 時限 column keeps the five days equally wide; below
          680px it scrolls sideways with 時限 kept in view. Dense cells (px-2.5) leave
          room for a 9-character subject on one line at 1024. */}
      <TableWrap
        className="hidden lg:block print:block"
        tableClassName="table-fixed min-w-[680px]"
      >
        <colgroup>
          <col className="w-[80px]" />
          {days.map((day) => (
            <col key={day.date} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <Th stickyLeft dense>
              時限
            </Th>
            {days.map((day) => (
              <Th key={day.date} dense highlight={day.date === today}>
                {formatDate(day.date, today)}
                {day.closures.map((name) => (
                  <span
                    key={name}
                    className="mt-0.5 block whitespace-normal font-normal text-amber-ink"
                  >
                    {name}
                  </span>
                ))}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((period) => (
            <tr key={period.no}>
              <Td
                stickyLeft
                dense
                className="align-top font-bold text-[#4a576c]"
              >
                {period.label}
                <span className="mt-0.5 block text-[11px] font-normal text-muted">
                  {period.start}-{period.end}
                </span>
              </Td>
              {days.map((day) => {
                const lessons = day.lessons.filter(
                  (lesson) => lesson.periodNo === period.no,
                );
                return (
                  <Td
                    key={day.date}
                    dense
                    className={`whitespace-normal align-top ${
                      day.date === today ? "bg-[#f2f5ff]" : ""
                    }`}
                  >
                    {!day.entered ? (
                      <span className="text-muted">未定</span>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {lessons.map((lesson) => (
                          <div key={lesson.id}>
                            <div
                              className={`font-bold ${lesson.cancelled ? "text-muted line-through" : ""}`}
                            >
                              {lesson.subject}
                            </div>
                            <div className="mt-0.5 text-[11px]">
                              <span
                                className={`font-semibold ${
                                  lesson.cancelled
                                    ? "text-muted line-through"
                                    : "text-navy"
                                }`}
                              >
                                {roomText(lesson.room)}
                              </span>{" "}
                              <span className="text-muted">
                                / {teacherText(lesson.teachers)}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
                              <LessonBadges lesson={lesson} wrap />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </>
  );
}

/** The week on phones: a section per day with compact lesson rows. */
function WeekList({ days, today }: { days: TimetableDay[]; today: string }) {
  return (
    <div className="flex flex-col gap-5 lg:hidden print:hidden">
      {days.map((day) => {
        const isToday = day.date === today;
        return (
          <section key={day.date}>
            <h2 className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
              <span className={isToday ? "text-brand-dark" : ""}>
                {formatDate(day.date, today)}
              </span>
              {isToday && <Badge kind="busy">今日</Badge>}
              {day.closures.map((name) => (
                <Badge key={name} kind="warning" wrap>
                  {name}
                </Badge>
              ))}
            </h2>
            <Card className="overflow-hidden">
              {!day.entered ? (
                <p className="px-4 py-3 text-xs text-muted">未定</p>
              ) : (
                <ul className="divide-y divide-line">
                  {PERIODS.map((period) => {
                    const lessons = day.lessons.filter(
                      (lesson) => lesson.periodNo === period.no,
                    );
                    return (
                      <li
                        key={period.no}
                        className="grid grid-cols-[60px_minmax(0,1fr)] gap-3 px-4 py-3"
                      >
                        <div className="text-xs font-bold text-[#4a576c]">
                          {period.label}
                          <span className="mt-0.5 block text-[11px] font-normal text-muted">
                            {period.start}-{period.end}
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-col gap-2.5">
                          {lessons.length === 0 ? (
                            <span className="text-xs text-muted">授業なし</span>
                          ) : (
                            lessons.map((lesson) => (
                              <CompactLesson key={lesson.id} lesson={lesson} />
                            ))
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </section>
        );
      })}
    </div>
  );
}

function CompactLesson({ lesson }: { lesson: LessonView }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`text-[13px] font-bold ${
              lesson.cancelled ? "text-muted line-through" : ""
            }`}
          >
            {lesson.subject}
          </span>
          <LessonBadges lesson={lesson} wrap />
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
          {lesson.className && <span>{lesson.className}</span>}
          <span>{teacherText(lesson.teachers)}</span>
        </div>
      </div>
      <span
        className={`shrink-0 text-base font-bold ${
          lesson.cancelled ? "text-muted line-through" : "text-navy"
        }`}
      >
        {roomText(lesson.room)}
      </span>
    </div>
  );
}

// Below xl (phones, tablets, and laptops where the sidebar leaves under 1000px) the month
// is a compact calendar whose days open the day view. From xl it is the table laid out
// like the paper timetable; the table is also what is printed.
function MonthView({
  days,
  month,
  today,
  weekStart,
  dayHref,
}: {
  days: TimetableDay[];
  month: string;
  today: string;
  weekStart: WeekStart;
  dayHref: (date: string) => string;
}) {
  // The page also loads the days of the first and last weeks that fall in the next
  // and previous months (the calendar draws them); the table does not.
  const inMonth = days.filter((day) => monthOf(day.date) === month);
  return (
    <>
      <MonthCalendar
        days={days}
        month={month}
        today={today}
        weekStart={weekStart}
        dayHref={dayHref}
      />
      <div className="hidden flex-col gap-4 xl:flex print:flex">
        {monthHalves(inMonth).map((band) => (
          <MonthBand
            key={band[0].date}
            days={band}
            month={month}
            today={today}
            dayHref={dayHref}
          />
        ))}
      </div>
    </>
  );
}

/** A day shown as one cell down all four periods, and why. null: a cell per period. */
function wholeDayKind(
  day: TimetableDay,
): "closure" | "weekend" | "undecided" | null {
  if (day.lessons.length > 0) return null;
  if (day.closures.length > 0) return "closure";
  if (weekdayOf(day.date) % 6 === 0) return "weekend";
  if (!day.entered) return "undecided";
  return null;
}

/** 土/日 without lessons: a narrow grey column, so the weekdays get the room. */
function isQuietWeekend(day: TimetableDay): boolean {
  return weekdayOf(day.date) % 6 === 0 && day.lessons.length === 0;
}

/** The fill of a date's header cells: today, 休み・行事, weekend, or plain. */
function dateHeadTone(day: TimetableDay, today: string): string {
  if (day.date === today) return "bg-[#e8ecff] text-brand-dark";
  if (day.closures.length > 0) return "bg-amber-soft text-amber-ink";
  if (weekdayOf(day.date) % 6 === 0) return "bg-[#edf0f5] text-muted";
  return "bg-[#f6f8fc] text-[#586579]";
}

const MONTH_HEAD_CELL =
  "border-b border-l border-line px-0.5 py-1.5 text-center text-[11px] font-semibold";
const VERTICAL_TEXT =
  "inline-block [text-orientation:upright] [writing-mode:vertical-rl]";

/**
 * Half a month as the paper timetable shows it: 日付 and 曜日 across the top, 1限〜4限
 * down the side, and in each cell the subject, room and teacher. Below 900px of table
 * (never at xl) it scrolls sideways with 1限〜4限 kept in view.
 */
function MonthBand({
  days,
  month,
  today,
  dayHref,
}: {
  days: TimetableDay[];
  month: string;
  today: string;
  dayHref: (date: string) => string;
}) {
  const monthNo = Number(month.slice(5, 7));
  return (
    <TableWrap
      className="print:overflow-visible"
      tableClassName="table-fixed min-w-[900px] print:min-w-0"
    >
      <colgroup>
        <col className="w-[84px]" />
        {days.map((day) => (
          <col key={day.date} className={isQuietWeekend(day) ? "w-7" : ""} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <Th stickyLeft dense scope="row">
            日付({monthNo}月)
          </Th>
          {days.map((day) => (
            <th
              key={day.date}
              scope="col"
              className={`${MONTH_HEAD_CELL} ${dateHeadTone(day, today)}`}
            >
              {/* The date opens the day view. */}
              <Link
                href={dayHref(day.date)}
                className="inline-flex min-h-6 min-w-6 items-center justify-center hover:underline"
              >
                <span className="sr-only">
                  {formatLongDate(day.date)}
                  {day.date === today && " 今日"}
                </span>
                <span aria-hidden="true">{Number(day.date.slice(8, 10))}</span>
              </Link>
            </th>
          ))}
        </tr>
        <tr>
          <Th stickyLeft dense scope="row">
            曜日
          </Th>
          {days.map((day) => (
            <th
              key={day.date}
              scope="col"
              className={`${MONTH_HEAD_CELL} ${dateHeadTone(day, today)}`}
            >
              {WEEKDAY_NAMES[weekdayOf(day.date)]}
              {/* 休み・行事 on a day that still has lessons: named here, since the
                  column is not one merged cell. */}
              {day.lessons.length > 0 &&
                day.closures.map((name) => (
                  <span
                    key={name}
                    className="mt-0.5 block font-normal [overflow-wrap:anywhere]"
                  >
                    {name}
                  </span>
                ))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {PERIODS.map((period, index) => (
          <tr key={period.no}>
            <Td
              stickyLeft
              dense
              className="align-middle font-bold text-[#4a576c]"
            >
              {period.label}
              <span className="mt-0.5 block text-[11px] font-normal text-muted">
                {period.start}-{period.end}
              </span>
            </Td>
            {days.map((day) => {
              const kind = wholeDayKind(day);
              if (kind !== null) {
                // One cell down all four periods, drawn in the first row only.
                return index === 0 ? (
                  <WholeDayCell key={day.date} day={day} kind={kind} />
                ) : null;
              }
              const lessons = day.lessons.filter(
                (lesson) => lesson.periodNo === period.no,
              );
              return (
                <td
                  key={day.date}
                  className={`whitespace-normal border-b border-l border-line px-1 py-2 text-center align-middle text-[11px] leading-snug ${
                    day.date === today ? "bg-[#f2f5ff]" : ""
                  }`}
                >
                  <div className="flex flex-col gap-2.5">
                    {lessons.map((lesson) => (
                      <MonthLesson key={lesson.id} lesson={lesson} />
                    ))}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

/** A day with no lessons: 休み・行事 (written top to bottom), a weekend, or 未定. */
function WholeDayCell({
  day,
  kind,
}: {
  day: TimetableDay;
  kind: "closure" | "weekend" | "undecided";
}) {
  // No bottom border: the cell reaches the last row, whose edge the box draws.
  const tone =
    kind === "closure"
      ? "bg-amber-soft text-amber-ink"
      : kind === "weekend"
        ? "bg-[#edf0f5]"
        : "bg-[#f6f8fc] text-muted";
  return (
    <td
      rowSpan={PERIODS.length}
      className={`whitespace-normal border-l border-line px-0.5 py-3 text-center align-middle text-xs ${tone}`}
    >
      {kind === "closure" && (
        <span
          className={`${VERTICAL_TEXT} text-sm font-bold leading-tight tracking-[0.15em]`}
        >
          {day.closures.join("・")}
        </span>
      )}
      {kind === "undecided" && (
        <span className={`${VERTICAL_TEXT} tracking-[0.15em]`}>未定</span>
      )}
      {kind === "weekend" && <span className="sr-only">授業なし</span>}
    </td>
  );
}

/** One lesson in the month table: subject, room, then the teacher (or the class). */
function MonthLesson({ lesson }: { lesson: LessonView }) {
  const struck = lesson.cancelled ? "text-muted line-through" : "";
  return (
    <div>
      <div className={`font-bold [overflow-wrap:anywhere] ${struck}`}>
        {lesson.subject}
      </div>
      <div className={`font-semibold ${struck || "text-navy"}`}>
        {roomText(lesson.room)}
      </div>
      <div className="text-muted [overflow-wrap:anywhere]">
        {lesson.className ?? teacherText(lesson.teachers)}
      </div>
      {/* anywhere: 教室変更(602から変更) still fits a narrow column (portrait print). */}
      <div className="mt-1 flex flex-wrap justify-center gap-1 [overflow-wrap:anywhere] empty:hidden">
        <LessonBadges lesson={lesson} wrap />
      </div>
    </div>
  );
}

/** The month below xl: 7 narrow columns, each day a link to its day view. */
function MonthCalendar({
  days,
  month,
  today,
  weekStart,
  dayHref,
}: {
  days: TimetableDay[];
  month: string;
  today: string;
  weekStart: WeekStart;
  dayHref: (date: string) => string;
}) {
  const lastRowFrom = days.length - 7;
  return (
    <div className="xl:hidden print:hidden">
      <div className="overflow-hidden rounded-[11px] border border-line bg-white">
        <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
          {weekdayHeaders(weekStart).map((name) => (
            <div
              key={name}
              className="border-b border-line bg-[#f6f8fc] py-2 text-center text-[11px] font-semibold text-[#586579]"
            >
              {name}
            </div>
          ))}
          {days.map((day, index) => {
            const outside = monthOf(day.date) !== month;
            const weekend = weekdayOf(day.date) % 6 === 0;
            const isToday = day.date === today;
            const count = day.lessons.filter(
              (lesson) => !lesson.cancelled,
            ).length;
            const cancelled = day.lessons.some((lesson) => lesson.cancelled);
            return (
              <Link
                key={day.date}
                href={dayHref(day.date)}
                className={`flex min-h-[64px] min-w-0 flex-col items-center gap-1 border-r border-line px-0.5 pb-1.5 pt-1 text-center focus-visible:-outline-offset-3 ${
                  index >= lastRowFrom ? "" : "border-b"
                } ${
                  isToday
                    ? "bg-[#f2f5ff]"
                    : outside
                      ? "bg-[#f6f8fc] text-muted"
                      : ""
                }`}
              >
                <span className="sr-only">
                  {formatLongDate(day.date)}
                  {isToday && " 今日"}
                </span>
                <span
                  aria-hidden="true"
                  className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${
                    isToday
                      ? "bg-brand font-bold text-white"
                      : outside
                        ? "font-normal"
                        : "font-bold"
                  }`}
                >
                  {Number(day.date.slice(8, 10))}
                </span>
                {count > 0 && (
                  <span
                    className={`text-[11px] leading-none ${outside ? "" : "text-[#4a576c]"}`}
                  >
                    {count}コマ
                  </span>
                )}
                {!outside && !weekend && !day.entered && (
                  <span className="text-[11px] leading-none text-muted">
                    未定
                  </span>
                )}
                {(cancelled || day.closures.length > 0) && (
                  <span className="flex items-center gap-1">
                    {day.closures.length > 0 && (
                      <>
                        <span
                          aria-hidden="true"
                          className="size-2 rotate-45 bg-[#b86e00]"
                        />
                        <span className="sr-only">
                          {day.closures.join("、")}
                        </span>
                      </>
                    )}
                    {cancelled && (
                      <>
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full bg-red-ink"
                        />
                        <span className="sr-only">休講あり</span>
                      </>
                    )}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rotate-45 bg-[#b86e00]" />
          休み・行事
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-red-ink" />
          休講あり
        </span>
      </p>
    </div>
  );
}

// S03 時間割
export function TimetableView({
  mode,
  date,
  weekStart = "mon",
  today,
  minutes,
  days,
  classes,
  selectedClassId,
  todayFiscalYear,
  teachers,
  selectedTeacherId,
  canChange,
  basePath = "/timetable",
  changeBasePath = "/teacher/lessons",
  addHref = null,
}: {
  mode: TimetableMode;
  date: string;
  /** 週の始まり (week and month views). */
  weekStart?: WeekStart;
  today: string;
  minutes: number;
  days: TimetableDay[];
  classes: ClassOption[];
  selectedClassId: string | null;
  todayFiscalYear: number;
  teachers: { id: string; name: string }[];
  selectedTeacherId: string | null;
  canChange: boolean;
  basePath?: string;
  /** Where S14 lives: `${changeBasePath}/${lesson id}`. */
  changeBasePath?: string;
  /** Where 「授業を足す」 goes. Left out until the screen exists. */
  addHref?: string | null;
}) {
  const scope = {
    class: selectedClassId,
    teacher: selectedTeacherId,
  };
  // Sunday travels in every link while it is chosen. The switch itself always names
  // its side (start=mon too), which is what WeekStartMemory remembers.
  const hrefFor = (next: {
    view?: TimetableMode;
    date?: string;
    start?: WeekStart;
  }) =>
    withQuery(basePath, {
      ...scope,
      view: next.view ?? mode,
      date: next.date ?? date,
      start: next.start ?? (weekStart === "sun" ? "sun" : null),
    });
  const showsWeeks = mode === "week" || mode === "month";
  const previous =
    mode === "day"
      ? addDays(date, -1)
      : mode === "week"
        ? addDays(date, -7)
        : `${addMonths(monthOf(date), -1)}-01`;
  const following =
    mode === "day"
      ? addDays(date, 1)
      : mode === "week"
        ? addDays(date, 7)
        : `${addMonths(monthOf(date), 1)}-01`;
  const subject = selectedTeacherId
    ? teachers.find((item) => item.id === selectedTeacherId)?.name
    : classes.find((item) => item.id === selectedClassId)?.name;
  const allClosures = mode === "day" ? (days[0]?.closures ?? []) : [];

  return (
    <>
      <PageHeading
        title="時間割"
        actions={
          <MyClassSelect
            classes={classes}
            selectedId={selectedTeacherId ? null : selectedClassId}
            todayFiscalYear={todayFiscalYear}
            emptyLabel={selectedTeacherId ? "(講師で表示中)" : undefined}
          />
        }
      />
      {/* Phones: three aligned full-width rows (表示 / 前へ・今日・次へ / 日付・講師).
          From sm everything sits inline and wraps. */}
      <FilterBar className="print:hidden">
        <Segmented
          stretch
          label="表示"
          items={(
            [
              ["day", "今日"],
              ["week", "今週"],
              ["month", "月"],
            ] as const
          ).map(([view, label]) => ({
            label,
            href: hrefFor({ view }),
            active: mode === view,
          }))}
        />
        {/* The month table from xl runs date by date, so 週の始まり only changes the
            calendar below xl: from xl it is hidden in the month view. */}
        {showsWeeks && (
          <div className={mode === "month" ? "contents xl:hidden" : "contents"}>
            <Segmented
              stretch
              label="週の始まり"
              items={(
                [
                  ["mon", "月曜始まり"],
                  ["sun", "日曜始まり"],
                ] as const
              ).map(([start, label]) => ({
                label,
                href: hrefFor({ start }),
                active: weekStart === start,
              }))}
            />
          </div>
        )}
        <div className="grid w-full grid-cols-3 gap-1.5 sm:flex sm:w-auto sm:items-center">
          <LinkButton size="sm" href={hrefFor({ date: previous })}>
            <Icon name="chevronLeft" size={13} />
            前へ
          </LinkButton>
          <LinkButton size="sm" href={hrefFor({ date: today })}>
            今日
          </LinkButton>
          <LinkButton size="sm" href={hrefFor({ date: following })}>
            次へ
            <Icon name="chevron" size={13} />
          </LinkButton>
        </div>
        <Form
          action={basePath}
          className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2.5"
        >
          <input type="hidden" name="view" value={mode} />
          {selectedClassId && !selectedTeacherId && (
            <input type="hidden" name="class" value={selectedClassId} />
          )}
          {weekStart === "sun" && (
            <input type="hidden" name="start" value="sun" />
          )}
          <AutoSubmitInput
            key={date}
            type="date"
            name="date"
            defaultValue={date}
            aria-label="基準の日"
            className={`${filterFieldClass} w-full min-w-0 sm:w-auto`}
          />
          <AutoSubmitSelect
            key={selectedTeacherId ?? "none"}
            className={`${filterSelectClass} w-full min-w-0 sm:w-auto`}
            name="teacher"
            defaultValue={selectedTeacherId ?? ""}
            aria-label="講師で絞る"
          >
            <option value="">講師で絞らない</option>
            {teachers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </AutoSubmitSelect>
          <noscript>
            <button type="submit">表示</button>
          </noscript>
        </Form>
      </FilterBar>

      <Callout icon="calendar">
        <strong className="font-semibold">{subject ?? "クラス未選択"}</strong>
        <br />
        {mode === "month"
          ? formatMonth(monthOf(date))
          : mode === "week"
            ? `${formatLongDate(weekStartOf(date, weekStart))} の週`
            : formatLongDate(date)}
        の時間割
      </Callout>

      {allClosures.length > 0 && (
        <Callout kind="warning" icon="calendar">
          {allClosures.join("、")}
        </Callout>
      )}

      {/* Only the lesson list is capped (max-w-4xl), so on wide screens the room
            stays close to its lesson. The banner and callouts span the full width, like
            the filter bar above and the week and month views. */}
      {mode === "day" && days[0] && (
        <div className="mx-auto max-w-4xl">
          <DayView
            day={days[0]}
            today={today}
            minutes={minutes}
            canChange={canChange}
            changeBasePath={changeBasePath}
            addHref={addHref}
          />
        </div>
      )}
      {mode === "week" && <WeekView days={days} today={today} />}
      {mode === "month" && (
        <MonthView
          days={days}
          month={monthOf(date)}
          today={today}
          weekStart={weekStart}
          dayHref={(day) => hrefFor({ view: "day", date: day })}
        />
      )}
      {showsWeeks && <WeekStartMemory />}
    </>
  );
}
