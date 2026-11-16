import "server-only";
import { determineRole } from "@/lib/auth/policy";
import { REQUESTER_NAME_MAX } from "@/lib/domain/reservation-core";
import { getDb } from "./db";
import { getEnv } from "./env";

// 代理入力 (S12) の依頼者: 登録済みの生徒を、名前で探して選ぶ。先生にだけ見せる。
// 出すのは、利用者の ID と名前だけ (メールは、選ぶ前にも後にも、出さない)。

export type Requester = { id: string; name: string };

const MIN_QUERY = 2;
const LIMIT = 10;
// 先生や管理者を除くと、10人に満たなくなるので、多めに読む
const READ_LIMIT = 40;

/** 生徒かどうか: 画面を開くたびの判定 (session.ts) と同じ規則 (先生・管理者は、生徒ではない)。 */
async function studentChecker(): Promise<(email: string) => boolean> {
  const db = getDb();
  const env = getEnv();
  const [admins, teachers] = await Promise.all([
    db.adminEmail.findMany({ select: { email: true } }),
    env.STUDENT_EMAIL_PATTERN
      ? Promise.resolve([])
      : db.teacher.findMany({
          where: { active: true, email: { not: null } },
          select: { email: true },
        }),
  ]);
  const adminEmails = admins.map((row) => row.email);
  const teacherEmails = teachers.flatMap((row) =>
    row.email ? [row.email] : [],
  );
  return (email) =>
    determineRole({
      email,
      initialAdminEmail: env.INITIAL_ADMIN_EMAIL,
      adminEmails,
      activeTeacherEmails: teacherEmails,
      studentEmailPattern: env.STUDENT_EMAIL_PATTERN,
    }) === "student";
}

/** 検索のことば: 前後の空白と制御文字を除く。2文字以上、20文字まで。合わなければ null。 */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const length = [...value].length;
  return length >= MIN_QUERY && length <= REQUESTER_NAME_MAX ? value : null;
}

/** 名前に、ことばを含む生徒 (最大10人)。探している先生本人は出さない。 */
export async function searchRequesters(
  rawQuery: unknown,
  selfId: string,
): Promise<Requester[]> {
  const query = normalizeQuery(rawQuery);
  if (query === null) return [];
  const [rows, isStudent] = await Promise.all([
    getDb().user.findMany({
      where: {
        name: { contains: query, mode: "insensitive" },
        id: { not: selfId },
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: READ_LIMIT,
    }),
    studentChecker(),
  ]);
  return rows
    .filter((row) => isStudent(row.email))
    .slice(0, LIMIT)
    .map((row) => ({ id: row.id, name: row.name }));
}

/** 選んだ人が、いま選べる生徒か (サーバーで、もう一度確かめる)。先生本人は選べない。 */
export async function findSelectableStudent(
  id: string,
  selfId: string,
): Promise<Requester | null> {
  if (id === selfId || id === "" || id.length > 64) return null;
  const row = await getDb().user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  });
  if (row === null) return null;
  return (await studentChecker())(row.email)
    ? { id: row.id, name: row.name }
    : null;
}
