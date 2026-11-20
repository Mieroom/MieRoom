import { NextRequest } from "next/server";
import { testDb } from "./db";
import { ROOM_FREE_NAME } from "./fixtures";

// 時間割の取り込み (T-IMP) の結合テストで使う補助: 取込用 CSV を作り、アップロードの要求を作る。
// 授業の入れ方は、クラス「システム専攻1年」(seedBase)・教科「プログラミング」・講師「田村」・
// 教室「展示室」(1限・固定)。第 1 回・第 2 回のテストが、同じ形を使う。

export const HOST = "mieroom.example";
export const CLASS_NAME = "システム専攻1年";

export const HEAD = [
  "クラス",
  "日付",
  "曜日",
  "時限",
  "開始",
  "終了",
  "科目",
  "講師",
  "教室",
  "区分",
  "当月の最終入力日",
  "翌月の最終入力日",
  "対象年月",
  "ホームルーム教室",
];
export type Cells = Record<string, string>;

/** 見出しが 1 行目。最初の行(月の最初の平日の授業)は、2 行目。 */
export const FIRST_LESSON_LINE = 2;

/** 11 月の休み・行事。11/12・13 と 11/23 は、全校の休み・行事(seedBase)と同じ名前。 */
export const CLOSURES: Record<string, string> = {
  "2026-11-03": "文化の日",
  "2026-11-12": "学園祭",
  "2026-11-13": "学園祭",
  "2026-11-23": "勤労感謝の日",
};

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

export type MonthOptions = {
  /** "YYYY-MM"。既定は 2026-11 */
  month?: string;
  className?: string;
  homeRoom?: string;
  /** 日付 → 休み・行事の名称。この日は授業を入れない。 */
  closures?: Record<string, string>;
  /** 翌月 1〜11 日の仮の時間割。until は、翌月の最終入力日(例: "2026-12-11") */
  provisional?: { until: string; closures?: Record<string, string> };
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 1 か月分の、正しいファイルの行。平日ごとに、1限の授業(休み・行事の日は、その行)。
 * 土日は行を作らない。`provisional` があれば、翌月 1 日から最終入力日までの平日も作る。
 * 最初の授業の行は、2 行目になる(見出しが 1 行目)。
 */
export function monthRows(options: MonthOptions = {}): Cells[] {
  const month = options.month ?? "2026-11";
  const className = options.className ?? CLASS_NAME;
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const common = {
    クラス: className,
    当月の最終入力日: `${month}-${pad(lastDay)}`,
    翌月の最終入力日: options.provisional?.until ?? "",
    対象年月: month.replace("-", ""),
    ホームルーム教室: options.homeRoom ?? "101",
  };
  const rows: Cells[] = [];
  const add = (date: string, closure: string | undefined) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) return;
    const base = { ...common, 日付: date, 曜日: WEEKDAY[weekday] };
    rows.push(
      closure === undefined
        ? {
            ...base,
            時限: "1限",
            開始: "9:15",
            終了: "10:45",
            科目: "プログラミング",
            講師: "田村",
            教室: ROOM_FREE_NAME,
            区分: "固定",
          }
        : {
            ...base,
            時限: "",
            開始: "",
            終了: "",
            科目: closure,
            講師: "",
            教室: "",
            区分: "休み・行事",
          },
    );
  };
  for (let day = 1; day <= lastDay; day++) {
    const date = `${month}-${pad(day)}`;
    add(date, options.closures?.[date]);
  }
  if (options.provisional) {
    const until = Number(options.provisional.until.slice(8, 10));
    for (let day = 1; day <= until; day++) {
      const date = `${nextYear}-${pad(nextMon)}-${pad(day)}`;
      add(date, options.provisional.closures?.[date]);
    }
  }
  return rows;
}

/** 2026 年 11 月の、正しい 1 か月分(第 1 回から使っている形)。 */
export const monthCells = (
  closures: Record<string, string> = CLOSURES,
  className = CLASS_NAME,
): Cells[] => monthRows({ month: "2026-11", closures, className });

export function csvText(rows: Cells[], head: string[] = HEAD): string {
  const lines = [head.join(",")];
  for (const row of rows) lines.push(head.map((h) => row[h] ?? "").join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export type Upload = { name: string; bytes: Uint8Array };
export const utf8 = (text: string) => new TextEncoder().encode(text);
export const csvFile = (
  name: string,
  rows: Cells[],
  head?: string[],
): Upload => ({
  name,
  bytes: utf8(csvText(rows, head)),
});

/** A request the way a browser sends it: the body is already encoded and its length is known. */
export async function upload(path: string, files: Upload[]) {
  const form = new FormData();
  for (const file of files) {
    form.append(
      "files",
      new File([file.bytes as BlobPart], file.name, { type: "text/csv" }),
    );
  }
  return formRequest(path, form);
}

/** 同じサイトの画面から送った形のフォームの要求(例外解除など)。 */
export async function formRequest(path: string, form: FormData) {
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  return new NextRequest(`https://${HOST}${path}`, {
    method: "POST",
    body,
    headers: {
      host: HOST,
      "sec-fetch-site": "same-origin",
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(body.length),
    },
  });
}

export type Issue = {
  level: string;
  code: string;
  line: number | null;
  message: string;
};
export type FileView = {
  name: string;
  className: string | null;
  month: string | null;
  lessonCount: number;
  closureCount: number;
  verdict: string;
  issues: Issue[];
};
export type View = {
  files: FileView[];
  general: Issue[];
  ok: boolean;
  lostChanges: number;
};
export type ApplyBody = {
  kind: "imported" | "invalid";
  view: View;
  summary?: { months: { month: string; classes: number; lessons: number }[] };
};

export const issueOf = (file: FileView, code: string) =>
  file.issues.find((issue) => issue.code === code);

export async function counts() {
  const db = testDb();
  return {
    lessons: await db.lesson.count(),
    lessonTeachers: await db.lessonTeacher.count(),
    months: await db.monthStatus.count(),
    toolClosures: await db.closure.count({ where: { source: "TOOL" } }),
  };
}
export const EMPTY = {
  lessons: 0,
  lessonTeachers: 0,
  months: 0,
  toolClosures: 0,
};
