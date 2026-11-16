import { notFound } from "next/navigation";
import { ForbiddenView } from "@/app/forbidden-view";
import { MastersView, type MasterTab } from "@/components/screens/admin-views";
import { fiscalYearOfDate, schoolToday } from "@/lib/domain/school-date";
import { noticeText } from "@/lib/notice";
import { loadMaster } from "@/lib/server/queries/admin";
import {
  listActiveTeachers,
  listClassesForYear,
  loadRoomList,
} from "@/lib/server/queries/common";
import { hasRole, requireUser } from "@/lib/server/session";
import { one } from "@/lib/url";

function parseTab(value: string): MasterTab | null {
  return value === "classes" ||
    value === "teachers" ||
    value === "subjects" ||
    value === "rooms"
    ? value
    : null;
}

/** A count from the address (MW502): a whole number, or nothing. */
const count = (value: string | undefined) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 100_000
    ? number
    : 0;
};

// S21 マスタ
export default async function MastersPage({
  params,
  searchParams,
}: PageProps<"/admin/masters/[tab]">) {
  const user = await requireUser();
  if (!hasRole(user, "admin")) return <ForbiddenView />;
  const tab = parseTab((await params).tab);
  if (!tab) notFound();
  const query = await searchParams;
  const showInactive = one(query.inactive) === "1";
  const year = fiscalYearOfDate(schoolToday(new Date()));
  // The rooms are needed for the 教室 box of a class, and for the links of a new 教科.
  const rooms =
    tab === "classes" || tab === "subjects" ? await loadRoomList() : [];
  // 教科の追加は、紐づけも一緒に入れられる: 今年度のクラスと、有効な講師から選ぶ。
  const linkChoices =
    tab === "subjects"
      ? {
          classes: await listClassesForYear(year),
          teachers: await listActiveTeachers(),
        }
      : undefined;
  return (
    <MastersView
      data={await loadMaster(tab, showInactive)}
      showInactive={showInactive}
      rooms={rooms.map((room) => ({ id: room.id, name: room.name }))}
      linkChoices={linkChoices}
      defaultYear={year}
      notice={noticeText(one(query.notice))}
      renamed={one(query.renamed) === "1"}
      fixCount={count(one(query.fix))}
    />
  );
}
