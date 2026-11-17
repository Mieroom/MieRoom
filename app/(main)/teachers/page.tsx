import { redirect } from "next/navigation";
import { TeachersView } from "@/components/screens/teachers-view";
import { opensMiniGame } from "@/lib/domain/mini-game";
import { fiscalYearOfDate, schoolToday } from "@/lib/domain/school-date";
import { loadTeacherDirectory } from "@/lib/server/queries/common";
import { requireUser } from "@/lib/server/session";
import { one } from "@/lib/url";

// S05 先生一覧
export default async function TeachersPage({
  searchParams,
}: PageProps<"/teachers">) {
  const user = await requireUser();
  const params = await searchParams;
  // 学生だけの隠し要素 (気づいた人だけ): 合言葉を入れると、ゲームへ移る。
  if (opensMiniGame(user.role, one(params.q))) {
    redirect("/play");
  }
  const query = (one(params.q) ?? "").trim().slice(0, 20);
  const teachers = await loadTeacherDirectory(
    fiscalYearOfDate(schoolToday(new Date())),
    query,
  );
  return <TeachersView teachers={teachers} query={query} />;
}
