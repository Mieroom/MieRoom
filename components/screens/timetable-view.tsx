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
  Segmented,
  TableWrap,
} from "@/components/ui/parts";
import { monthHalves } from "@/lib/domain/month-table";
import { PERIODS } from "@/lib/domain/periods";
import {
  addDays,
  addMonths,
  formatLongDate,
  formatMonth,
  monthOf,
  weekdayHeaders,
  weekdayOf,
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

/** month: what 時間割 opens with. day: one day in detail, opened from a date of the month. */
export type TimetableMode = "day" | "month";

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
      <div className="hidden flex-col gap-3 xl:flex print:flex">
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

// The month fits one screen (two bands, no page scroll at about 700px of window
// height and up), so every cell keeps its padding small.
const MONTH_HEAD_CELL =
  "border-b border-l border-line px-0.5 py-1 text-center text-[11px] font-semibold";
/** 日付 / 曜日 in the first column. */
const MONTH_SIDE_HEAD =
  "border-b border-line bg-[#f6f8fc] px-2.5 py-1 text-left text-[11px] font-semibold text-[#586579]";
const VERTICAL_TEXT =
  "inline-block [text-orientation:upright] [writing-mode:vertical-rl]";

/**
 * Half a month as the paper timetable shows it: 日付 and 曜日 across the top, 1限〜4限
 * down the side, and in each cell the subject, room and teacher. Shown from xl only,
 * where the table (at least 900px) fits without scrolling sideways, so the first
 * column does not need to stay in place.
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
          <th scope="row" className={MONTH_SIDE_HEAD}>
            日付({monthNo}月)
          </th>
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
          <th scope="row" className={MONTH_SIDE_HEAD}>
            曜日
          </th>
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
            {/* The last row has no bottom line: the box draws that edge. */}
            <th
              scope="row"
              className={`bg-white px-2.5 py-1 text-left align-middle font-bold text-[#4a576c] ${
                index < PERIODS.length - 1 ? "border-b border-line" : ""
              }`}
            >
              {period.label}
              <span className="block text-[11px] font-normal text-muted">
                {period.start}-{period.end}
              </span>
            </th>
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
                  className={`whitespace-normal border-b border-l border-line px-0.5 py-1 text-center align-middle text-[11px] leading-tight ${
                    day.date === today ? "bg-[#f2f5ff]" : ""
                  }`}
                >
                  <div className="flex flex-col gap-1.5">
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

const MARK_TONES = {
  error: "bg-red-soft text-red-ink",
  busy: "bg-[#e8ecff] text-[#1e36d6]",
  warning: "bg-amber-soft text-amber-ink",
} as const;

/**
 * A change, as a small tag at the end of the line it is about (the colors of
 * LessonBadges). A row of badges under each lesson would make every period taller
 * and push the month past one screen.
 */
function MonthMark({
  tone,
  label,
  children,
}: {
  tone: keyof typeof MARK_TONES;
  /** Read before the tag, when the tag alone does not say what changed. */
  label?: string;
  children: string;
}) {
  return (
    <span
      className={`ml-1 inline-block whitespace-nowrap rounded-[4px] px-1 py-px font-semibold leading-none ${MARK_TONES[tone]}`}
    >
      {label && <span className="sr-only">{label}</span>}
      {children}
    </span>
  );
}

/**
 * One lesson in the month table: subject, room, then the teacher (or the class). The
 * changes LessonBadges shows sit on those lines: 補講 by the subject, 教室変更 and 休講
 * by the room, 代理 by the teacher.
 */
function MonthLesson({ lesson }: { lesson: LessonView }) {
  const struck = lesson.cancelled ? "text-muted line-through" : "";
  return (
    <div>
      <div className="font-bold [overflow-wrap:anywhere]">
        <span className={struck}>{lesson.subject}</span>
        {lesson.extra && <MonthMark tone="busy">補講</MonthMark>}
      </div>
      <div className="font-semibold">
        <span className={struck || "text-navy"}>{roomText(lesson.room)}</span>
        {lesson.previousRoom !== null && (
          <MonthMark tone="warning" label="教室変更、">
            {`${roomText(lesson.previousRoom)}から`}
          </MonthMark>
        )}
        {lesson.cancelled && <MonthMark tone="error">休講</MonthMark>}
      </div>
      <div className="text-muted [overflow-wrap:anywhere]">
        {lesson.className ?? teacherText(lesson.teachers)}
        {lesson.previousTeachers !== null && (
          <MonthMark tone="warning">代理</MonthMark>
        )}
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
  /** 週の始まり (the month calendar below xl). */
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
  const isDay = mode === "day";
  // Sunday travels in every link while it is chosen. The switch itself always names
  // its side (start=mon too), which is what WeekStartMemory remembers. The month is
  // what opens by default, so only the day view names itself in the URL.
  const hrefFor = (next: {
    view?: TimetableMode;
    date?: string;
    start?: WeekStart;
  }) =>
    withQuery(basePath, {
      ...scope,
      view: (next.view ?? mode) === "day" ? "day" : null,
      date: next.date ?? date,
      start: next.start ?? (weekStart === "sun" ? "sun" : null),
    });
  const month = monthOf(date);
  const previous = isDay ? addDays(date, -1) : `${addMonths(month, -1)}-01`;
  const following = isDay ? addDays(date, 1) : `${addMonths(month, 1)}-01`;
  const subject = selectedTeacherId
    ? teachers.find((item) => item.id === selectedTeacherId)?.name
    : classes.find((item) => item.id === selectedClassId)?.name;
  /** The day or the month on screen. */
  const shown = isDay ? formatLongDate(date) : formatMonth(month);
  const closures = isDay ? (days[0]?.closures ?? []) : [];
  // Phones: a full row each (the day or month with 前・次, then 日付・講師, 週の始まり,
  // 自分のクラス). From sm the groups sit inline and wrap.
  const group = "w-full sm:w-auto print:hidden";
  const step = "flex-1 sm:flex-none";

  return (
    <>
      {/* One row instead of a heading, a filter box and a banner, so that the month
          below fits the window without scrolling. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-2xl font-bold leading-snug sm:text-[27px]">
          時間割
          {/* The controls are not printed: on paper the heading says whose and when. */}
          <span className="hidden text-lg print:inline">
            {` ${subject ?? "クラス未選択"} ${shown}`}
          </span>
        </h1>
        <div className={`flex flex-wrap items-center gap-1.5 ${group}`}>
          <span className="w-full text-sm font-bold sm:order-2 sm:w-auto sm:px-1.5">
            {shown}
          </span>
          {isDay && (
            <LinkButton
              size="sm"
              href={hrefFor({ view: "month" })}
              className={`${step} sm:order-0`}
            >
              <Icon name="calendar" size={13} />
              月の表へ
            </LinkButton>
          )}
          <LinkButton
            size="sm"
            href={hrefFor({ date: previous })}
            className={`${step} sm:order-1`}
          >
            <Icon name="chevronLeft" size={13} />
            {isDay ? "前の日" : "前の月"}
          </LinkButton>
          <LinkButton
            size="sm"
            href={hrefFor({ date: following })}
            className={`${step} sm:order-3`}
          >
            {isDay ? "次の日" : "次の月"}
            <Icon name="chevron" size={13} />
          </LinkButton>
          <LinkButton
            size="sm"
            href={hrefFor({ date: today })}
            className={`${step} sm:order-4`}
          >
            {isDay ? "今日" : "今月"}
          </LinkButton>
        </div>
        <Form
          action={basePath}
          className={`grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2.5 ${group}`}
        >
          {isDay && <input type="hidden" name="view" value="day" />}
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
            aria-label={isDay ? "表示する日" : "表示する月(日付で選ぶ)"}
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
        {/* The month table from xl runs date by date, so 週の始まり only changes the
            calendar below xl. */}
        {!isDay && (
          <div className={`${group} xl:hidden`}>
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
        <div className={`${group} sm:ml-auto`}>
          <MyClassSelect
            classes={classes}
            selectedId={selectedTeacherId ? null : selectedClassId}
            todayFiscalYear={todayFiscalYear}
            emptyLabel={selectedTeacherId ? "(講師で表示中)" : undefined}
          />
        </div>
      </div>

      {closures.length > 0 && (
        <Callout kind="warning" icon="calendar">
          {closures.join("、")}
        </Callout>
      )}

      {/* Only the lesson list is capped (max-w-4xl), so on wide screens the room
          stays close to its lesson. */}
      {isDay && days[0] && (
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
      {!isDay && (
        <MonthView
          days={days}
          month={month}
          today={today}
          weekStart={weekStart}
          dayHref={(day) => hrefFor({ view: "day", date: day })}
        />
      )}
      {!isDay && <WeekStartMemory />}
    </>
  );
}
