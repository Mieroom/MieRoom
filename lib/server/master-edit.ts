import "server-only";
import {
  isMasterKind,
  PARSERS,
  type FieldError,
  type MasterKind,
} from "@/lib/domain/master-edit";
import { buildExport } from "@/lib/domain/master-export";
import {
  fiscalYearOfDate,
  schoolToday,
  textToDateColumn,
} from "@/lib/domain/school-date";
import { MESSAGES } from "@/lib/messages";
import { getDb } from "./db";
import { inYear } from "./queries/common";
import { loadExportSource } from "./queries/export";
import { UUID } from "./reservations";

// S21 マスタ (F15). The route has checked the site, the sign-in and the 時間割管理者 role. Every
// value is checked here (R5-1〜R5-4); a name that is already taken is refused by the database
// too. A change is written only if the row is still the one the screen showed (ME902).

export type MasterResult =
  | {
      kind: "saved";
      notice: "MI501" | "MI502" | "MI502on";
      /** MW501: a name changed. Tell the 担任 to be given the CSVs again. */
      renamed: boolean;
      /** MW502: what is wrong for the CSV export, after this change. */
      exportIssues: number;
    }
  | { kind: "invalid"; errors: FieldError[] }
  | { kind: "conflict" }
  | { kind: "not_found" };

const isDuplicate = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code: unknown }).code === "P2002";

/** How many errors the export check (R5-6) finds now. Never stops a save. */
export async function countExportIssues(now: Date): Promise<number> {
  try {
    const year = fiscalYearOfDate(schoolToday(now));
    const result = buildExport(await loadExportSource(year));
    return result.issues.filter((issue) => issue.level === "error").length;
  } catch {
    return 0;
  }
}

/** 紐づけの「各担当」「教室未定」の行のキー (S22、取り込みと同じ)。 */
const EACH_TEACHER = "each";
const NO_ROOM = "none";
/** 教科を追加するとき、一緒に紐づけるクラスの数の上限 (マスタの上限と同じ)。 */
const MAX_LINK_CLASSES = 100;

type SubjectLinks = { classIds: string[]; teacherKey: string; roomKey: string };

/**
 * 教科の追加と一緒に入れる紐づけ (S21): どのクラスが取るか、講師、教室。講師は「各担当」、
 * 教室は「教室未定」の既定にできる。クラスを選ばなければ、紐づけは作らない (null)。
 * 選べるのは、今年度に存在する有効なクラス、有効な講師・教室だけ (S22 と同じ)。
 */
async function parseSubjectLinks(
  body: Record<string, unknown>,
  now: Date,
): Promise<
  { ok: true; links: SubjectLinks | null } | { ok: false; errors: FieldError[] }
> {
  const raw = body.classIds;
  if (raw === undefined || raw === null) return { ok: true, links: null };
  const invalid: { ok: false; errors: FieldError[] } = {
    ok: false,
    errors: [{ field: "links", message: MESSAGES.ME706 }],
  };
  if (!Array.isArray(raw) || raw.length > MAX_LINK_CLASSES) return invalid;
  const classIds = [...new Set(raw)];
  if (classIds.length === 0) return { ok: true, links: null };
  if (
    !classIds.every(
      (id): id is string => typeof id === "string" && UUID.test(id),
    )
  ) {
    return invalid;
  }
  const teacherKey =
    body.teacherId === undefined ? EACH_TEACHER : body.teacherId;
  const roomKey = body.roomId === undefined ? NO_ROOM : body.roomId;
  if (typeof teacherKey !== "string" || typeof roomKey !== "string")
    return invalid;

  const db = getDb();
  const year = fiscalYearOfDate(schoolToday(now));
  const [classes, teacher, room] = await Promise.all([
    db.schoolClass.count({ where: { id: { in: classIds }, ...inYear(year) } }),
    teacherKey === EACH_TEACHER
      ? Promise.resolve(true)
      : UUID.test(teacherKey)
        ? db.teacher.findFirst({
            where: { id: teacherKey, active: true },
            select: { id: true },
          })
        : Promise.resolve(null),
    roomKey === NO_ROOM
      ? Promise.resolve(true)
      : UUID.test(roomKey)
        ? db.room.findFirst({
            where: { id: roomKey, active: true },
            select: { id: true },
          })
        : Promise.resolve(null),
  ]);
  if (classes !== classIds.length || !teacher || !room) return invalid;
  return { ok: true, links: { classIds, teacherKey, roomKey } };
}

/** 教科を作り、選んだクラスへの紐づけ (クラスの教科、教科の講師、教科の教室) を、1回で書く。 */
async function createSubjectWithLinks(name: string, links: SubjectLinks) {
  await getDb().$transaction(async (tx) => {
    const subject = await tx.subject.create({
      data: { name },
      select: { id: true },
    });
    const subjectId = subject.id;
    await tx.classSubject.createMany({
      data: links.classIds.map((classId) => ({ classId, subjectId })),
    });
    await tx.subjectTeacher.createMany({
      data: links.classIds.map((classId) => ({
        classId,
        subjectId,
        teacherId: links.teacherKey === EACH_TEACHER ? null : links.teacherKey,
        teacherKey: links.teacherKey,
      })),
    });
    await tx.subjectRoom.createMany({
      data: links.classIds.map((classId) => ({
        classId,
        subjectId,
        roomId: links.roomKey === NO_ROOM ? null : links.roomKey,
        roomKey: links.roomKey,
      })),
    });
  });
}

/** クラスを追加するとき、一緒に紐づける教科の数の上限 (教科マスタの上限と同じ)。 */
const MAX_LINK_SUBJECTS = 100;

type ClassLink = { subjectId: string; teacherKey: string; roomKey: string };

/**
 * クラスの追加と一緒に入れる紐づけ (S21): そのクラスが取る教科と、教科ごとの講師・教室。講師は
 * 「各担当」、教室は「教室未定」を選べる。教科を選ばなければ、紐づけは作らない (null)。
 * 選べるのは、有効な教科・講師・教室だけ (S22 と同じ)。同じ教科を 2 つ入れることはできない。
 */
async function parseClassLinks(
  body: Record<string, unknown>,
): Promise<
  { ok: true; links: ClassLink[] | null } | { ok: false; errors: FieldError[] }
> {
  const raw = body.subjectLinks;
  if (raw === undefined || raw === null) return { ok: true, links: null };
  const invalid: { ok: false; errors: FieldError[] } = {
    ok: false,
    errors: [{ field: "links", message: MESSAGES.ME706 }],
  };
  if (!Array.isArray(raw) || raw.length > MAX_LINK_SUBJECTS) return invalid;
  if (raw.length === 0) return { ok: true, links: null };

  const links: ClassLink[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return invalid;
    const { subjectId, teacherId, roomId } = item as Record<string, unknown>;
    const teacherKey = teacherId === undefined ? EACH_TEACHER : teacherId;
    const roomKey = roomId === undefined ? NO_ROOM : roomId;
    if (
      typeof subjectId !== "string" ||
      !UUID.test(subjectId) ||
      typeof teacherKey !== "string" ||
      typeof roomKey !== "string" ||
      (teacherKey !== EACH_TEACHER && !UUID.test(teacherKey)) ||
      (roomKey !== NO_ROOM && !UUID.test(roomKey))
    ) {
      return invalid;
    }
    links.push({ subjectId, teacherKey, roomKey });
  }
  const subjectIds = links.map((link) => link.subjectId);
  if (new Set(subjectIds).size !== subjectIds.length) return invalid;
  const teacherIds = [
    ...new Set(
      links
        .map((link) => link.teacherKey)
        .filter((key) => key !== EACH_TEACHER),
    ),
  ];
  const roomIds = [
    ...new Set(
      links.map((link) => link.roomKey).filter((key) => key !== NO_ROOM),
    ),
  ];

  const db = getDb();
  const [subjects, teachers, rooms] = await Promise.all([
    db.subject.count({ where: { id: { in: subjectIds }, active: true } }),
    teacherIds.length === 0
      ? Promise.resolve(0)
      : db.teacher.count({ where: { id: { in: teacherIds }, active: true } }),
    roomIds.length === 0
      ? Promise.resolve(0)
      : db.room.count({ where: { id: { in: roomIds }, active: true } }),
  ]);
  if (
    subjects !== subjectIds.length ||
    teachers !== teacherIds.length ||
    rooms !== roomIds.length
  ) {
    return invalid;
  }
  return { ok: true, links };
}

/** クラスを作り、選んだ教科の紐づけ (クラスの教科、教科の講師、教科の教室) を、1 回で書く。 */
async function createClassWithLinks(
  value: Record<string, unknown>,
  links: ClassLink[],
) {
  await getDb().$transaction(async (tx) => {
    const created = await tx.schoolClass.create({
      data: {
        name: String(value.name),
        homeRoomId: String(value.homeRoomId),
        startYear: Number(value.startYear),
        endYear: value.endYear === null ? null : Number(value.endYear),
      },
      select: { id: true },
    });
    const classId = created.id;
    await tx.classSubject.createMany({
      data: links.map((link) => ({ classId, subjectId: link.subjectId })),
    });
    await tx.subjectTeacher.createMany({
      data: links.map((link) => ({
        classId,
        subjectId: link.subjectId,
        teacherId: link.teacherKey === EACH_TEACHER ? null : link.teacherKey,
        teacherKey: link.teacherKey,
      })),
    });
    await tx.subjectRoom.createMany({
      data: links.map((link) => ({
        classId,
        subjectId: link.subjectId,
        roomId: link.roomKey === NO_ROOM ? null : link.roomKey,
        roomKey: link.roomKey,
      })),
    });
  });
}

const parseVersion = (value: unknown): Date | null => {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
};

/** Is the name taken by another row (also an inactive one)? */
async function takenBy(
  kind: MasterKind,
  value: { name?: string; displayName?: string },
  selfId: string | null,
): Promise<FieldError[]> {
  const db = getDb();
  const other = selfId ? { id: { not: selfId } } : {};
  const errors: FieldError[] = [];
  switch (kind) {
    case "classes":
      if (
        await db.schoolClass.findFirst({
          where: { name: value.name, ...other },
          select: { id: true },
        })
      ) {
        errors.push({ field: "name", message: MESSAGES.ME502 });
      }
      break;
    case "subjects":
      if (
        await db.subject.findFirst({
          where: { name: value.name, ...other },
          select: { id: true },
        })
      ) {
        errors.push({ field: "name", message: MESSAGES.ME502 });
      }
      break;
    case "rooms":
      if (
        await db.room.findFirst({
          where: { name: value.name, ...other },
          select: { id: true },
        })
      ) {
        errors.push({ field: "name", message: MESSAGES.ME502 });
      }
      break;
    case "teachers": {
      const byName = await db.teacher.findFirst({
        where: { displayName: value.displayName, ...other },
        select: { id: true },
      });
      if (byName)
        errors.push({ field: "displayName", message: MESSAGES.ME502 });
      break;
    }
  }
  return errors;
}

/**
 * 追加 (no `id`) or 編集 (`id` and `version`, the updatedAt the screen showed).
 * Renaming a room, a subject or a teacher also renames it in the lessons from today on (R5-3);
 * past lessons keep the name of their day.
 */
export async function saveMaster(
  kind: unknown,
  raw: unknown,
  now: Date,
): Promise<MasterResult> {
  if (!isMasterKind(kind)) return { kind: "not_found" };
  const body =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const id = body.id === undefined || body.id === null ? null : body.id;
  if (id !== null && (typeof id !== "string" || !UUID.test(id))) {
    return { kind: "not_found" };
  }

  const parsed = PARSERS[kind](body);
  if (!parsed.ok) return { kind: "invalid", errors: parsed.errors };
  const value = parsed.value as Record<string, unknown> & {
    name?: string;
    displayName?: string;
  };

  const db = getDb();
  const errors = await takenBy(kind, value, id);
  if (kind === "classes") {
    const room = await db.room.findFirst({
      where: { id: String(value.homeRoomId), active: true },
      select: { id: true },
    });
    if (!UUID.test(String(value.homeRoomId)) || room === null) {
      errors.push({ field: "homeRoomId", message: MESSAGES.ME706 });
    }
  }
  // 教科の追加だけ、紐づけも一緒に入れられる (S21)。編集では使わない。
  let subjectLinks: SubjectLinks | null = null;
  if (kind === "subjects" && id === null) {
    const links = await parseSubjectLinks(body, now);
    if (!links.ok) errors.push(...links.errors);
    else subjectLinks = links.links;
  }
  // クラスの追加だけ、紐づけも一緒に入れられる (S21)。編集では使わない。
  let classLinks: ClassLink[] | null = null;
  if (kind === "classes" && id === null) {
    const links = await parseClassLinks(body);
    if (!links.ok) errors.push(...links.errors);
    else classLinks = links.links;
  }
  if (errors.length > 0) return { kind: "invalid", errors };

  const today = textToDateColumn(schoolToday(now));
  try {
    let renamed = false;
    if (id === null) {
      if (subjectLinks) {
        await createSubjectWithLinks(String(value.name), subjectLinks);
      } else if (classLinks) {
        await createClassWithLinks(value, classLinks);
      } else {
        await create(kind, value);
      }
    } else {
      const version = parseVersion(body.version);
      if (version === null) return { kind: "conflict" };
      const result = await update(kind, id, version, value, today);
      if (result === "gone") return { kind: "not_found" };
      if (result === "conflict") return { kind: "conflict" };
      renamed = result === "renamed";
    }
    return {
      kind: "saved",
      notice: "MI501",
      renamed,
      exportIssues: await countExportIssues(now),
    };
  } catch (error) {
    // Somebody took the name between the check and the write.
    if (isDuplicate(error)) {
      return {
        kind: "invalid",
        errors: [
          {
            field: kind === "teachers" ? "displayName" : "name",
            message: MESSAGES.ME502,
          },
        ],
      };
    }
    throw error;
  }
}

async function create(kind: MasterKind, value: Record<string, unknown>) {
  const db = getDb();
  switch (kind) {
    case "classes":
      await db.schoolClass.create({
        data: {
          name: String(value.name),
          homeRoomId: String(value.homeRoomId),
          startYear: Number(value.startYear),
          endYear: value.endYear === null ? null : Number(value.endYear),
        },
      });
      return;
    case "subjects":
      await db.subject.create({ data: { name: String(value.name) } });
      return;
    case "rooms":
      await db.room.create({
        data: {
          name: String(value.name),
          building: value.building as string | null,
          kind: value.kind as "HOMEROOM" | "FREE",
          note: value.note as string | null,
        },
      });
      return;
    case "teachers":
      await db.teacher.create({
        data: { displayName: String(value.displayName) },
      });
  }
}

/** "renamed": saved and a name changed; "saved": saved; "conflict": the row changed meanwhile. */
async function update(
  kind: MasterKind,
  id: string,
  version: Date,
  value: Record<string, unknown>,
  today: Date,
): Promise<"renamed" | "saved" | "conflict" | "gone"> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    const guard = { id, updatedAt: version };
    let count = 0;
    let oldName: string | null = null;
    let newName: string | null = null;

    switch (kind) {
      case "classes":
        // A class name is not copied into lessons (they point at the class), so only the
        // warning (MW501) depends on it.
        oldName =
          (
            await tx.schoolClass.findUnique({
              where: { id },
              select: { name: true },
            })
          )?.name ?? null;
        newName = String(value.name);
        count = (
          await tx.schoolClass.updateMany({
            where: guard,
            data: {
              name: newName,
              homeRoomId: String(value.homeRoomId),
              startYear: Number(value.startYear),
              endYear: value.endYear === null ? null : Number(value.endYear),
            },
          })
        ).count;
        break;
      case "subjects": {
        oldName =
          (
            await tx.subject.findUnique({
              where: { id },
              select: { name: true },
            })
          )?.name ?? null;
        newName = String(value.name);
        count = (
          await tx.subject.updateMany({ where: guard, data: { name: newName } })
        ).count;
        if (count === 1 && oldName !== newName) {
          await tx.lesson.updateMany({
            where: { subjectId: id, date: { gte: today } },
            data: { subjectName: newName },
          });
        }
        break;
      }
      case "rooms": {
        oldName =
          (await tx.room.findUnique({ where: { id }, select: { name: true } }))
            ?.name ?? null;
        newName = String(value.name);
        count = (
          await tx.room.updateMany({
            where: guard,
            data: {
              name: newName,
              building: value.building as string | null,
              kind: value.kind as "HOMEROOM" | "FREE",
              note: value.note as string | null,
            },
          })
        ).count;
        if (count === 1 && oldName !== newName) {
          await tx.lesson.updateMany({
            where: { roomId: id, date: { gte: today } },
            data: { roomName: newName },
          });
        }
        break;
      }
      case "teachers": {
        oldName =
          (
            await tx.teacher.findUnique({
              where: { id },
              select: { displayName: true },
            })
          )?.displayName ?? null;
        newName = String(value.displayName);
        count = (
          await tx.teacher.updateMany({
            where: guard,
            data: { displayName: newName },
          })
        ).count;
        if (count === 1 && oldName !== newName) {
          await tx.lessonTeacher.updateMany({
            where: { teacherId: id, lesson: { date: { gte: today } } },
            data: { teacherName: newName },
          });
        }
        break;
      }
    }

    if (count === 1) {
      // The name of a class is not copied anywhere: lessons point at the class.
      return oldName !== null && newName !== null && oldName !== newName
        ? "renamed"
        : "saved";
    }
    return (await exists(tx, kind, id)) ? "conflict" : "gone";
  });
}

type Tx = Parameters<
  Parameters<ReturnType<typeof getDb>["$transaction"]>[0]
>[0];

async function exists(tx: Tx, kind: MasterKind, id: string): Promise<boolean> {
  switch (kind) {
    case "classes":
      return (await tx.schoolClass.count({ where: { id } })) > 0;
    case "subjects":
      return (await tx.subject.count({ where: { id } })) > 0;
    case "rooms":
      return (await tx.room.count({ where: { id } })) > 0;
    case "teachers":
      return (await tx.teacher.count({ where: { id } })) > 0;
  }
}

/** 無効にする / 有効に戻す. Disabling asks first on the screen (MC501); enabling does not. */
export async function setMasterActive(
  kind: unknown,
  id: unknown,
  active: unknown,
  now: Date,
): Promise<MasterResult> {
  if (!isMasterKind(kind) || typeof id !== "string" || !UUID.test(id)) {
    return { kind: "not_found" };
  }
  if (typeof active !== "boolean") return { kind: "not_found" };
  const db = getDb();
  const where = { id };
  const data = { active };
  const count = (
    kind === "classes"
      ? await db.schoolClass.updateMany({ where, data })
      : kind === "subjects"
        ? await db.subject.updateMany({ where, data })
        : kind === "rooms"
          ? await db.room.updateMany({ where, data })
          : await db.teacher.updateMany({ where, data })
  ).count;
  if (count !== 1) return { kind: "not_found" };
  return {
    kind: "saved",
    notice: active ? "MI502on" : "MI502",
    renamed: false,
    exportIssues: await countExportIssues(now),
  };
}
