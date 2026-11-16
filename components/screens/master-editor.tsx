"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, fieldClass } from "@/components/ui/form";
import { MESSAGES, SYSTEM_ERROR_MESSAGE } from "@/lib/messages";

// S21: 追加・編集の窓と、無効にする / 有効に戻す. The server checks every value again and
// answers with the words of 10章; this only shows them next to the box they belong to.

type Tab = "classes" | "teachers" | "subjects" | "rooms";
export type EditableRow = {
  id: string;
  version: string;
  name: string;
  homeRoomId?: string;
  startYear?: number;
  endYear?: number | null;
  building?: string | null;
  kind?: "HOMEROOM" | "FREE";
  note?: string | null;
};

type FieldErrors = Record<string, string>;

/** 教科の追加と一緒に紐づけるときの、選べるもの (今年度のクラス、有効な講師)。 */
export type SubjectLinkChoices = {
  classes: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
};

/** クラスの追加と一緒に紐づけるときの、選べるもの (有効な教科、有効な講師)。 */
export type ClassLinkChoices = {
  subjects: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
};

async function send(
  endpoint: string,
  body: unknown,
): Promise<{
  ok: boolean;
  data: Record<string, unknown>;
  errors: FieldErrors;
  message: string | null;
}> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json().catch(() => null);
    const data =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    const errors: FieldErrors = {};
    if (Array.isArray(data.errors)) {
      for (const item of data.errors as {
        field?: string;
        message?: string;
      }[]) {
        if (item.field && item.message) errors[item.field] ??= item.message;
      }
    }
    return {
      ok: response.ok,
      data,
      errors,
      message:
        typeof data.message === "string"
          ? data.message
          : response.ok || Object.keys(errors).length > 0
            ? null
            : SYSTEM_ERROR_MESSAGE,
    };
  } catch {
    return { ok: false, data: {}, errors: {}, message: MESSAGES.ME901 };
  }
}

/** Shows what was done on this screen (MI501, MW501, MW502) and reads the list again. */
function useDone() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (data: Record<string, unknown>) => {
    const params = new URLSearchParams(search);
    params.set("notice", String(data.notice ?? "MI501"));
    if (data.renamed === true) params.set("renamed", "1");
    else params.delete("renamed");
    const issues = Number(data.exportIssues);
    if (Number.isInteger(issues) && issues > 0)
      params.set("fix", String(issues));
    else params.delete("fix");
    router.replace(`${pathname}?${params.toString()}`);
    router.refresh();
  };
}

function Text({
  name,
  label,
  errors,
  defaultValue,
  required = false,
  help,
  inputMode,
}: {
  name: string;
  label: string;
  errors: FieldErrors;
  defaultValue?: string | number | null;
  required?: boolean;
  help?: string;
  inputMode?: "numeric";
}) {
  return (
    <Field label={label} required={required} help={help} error={errors[name]}>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        inputMode={inputMode}
        autoComplete="off"
        className={fieldClass}
      />
    </Field>
  );
}

// 教科の追加 (S21): 紐づけ (クラスの教科、教科の講師、教科の教室) を、一緒に入れる。
// 選んだクラスすべてに、同じ講師と教室を入れる。クラスごとに変えるときは、あとで S22 で直す。
function SubjectLinkFields({
  choices,
  rooms,
  errors,
}: {
  choices: SubjectLinkChoices;
  rooms: { id: string; name: string }[];
  errors: FieldErrors;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const allChosen =
    choices.classes.length > 0 && chosen.size === choices.classes.length;
  return (
    <div
      role="group"
      aria-label="一緒に紐づける"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-lg border border-line p-3"
    >
      <p className="text-xs font-semibold">
        一緒に紐づける
        <span className="ml-2 font-normal text-muted">任意</span>
      </p>
      {choices.classes.length === 0 ? (
        <p className="text-[11px] text-muted">
          今年度に存在する有効なクラスがありません。
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold">
              クラス(今年度)
              <span className="ml-1.5 font-normal text-muted">
                {chosen.size}/{choices.classes.length}
              </span>
            </span>
            <Button
              size="sm"
              onClick={() =>
                setChosen(
                  allChosen
                    ? new Set()
                    : new Set(choices.classes.map((item) => item.id)),
                )
              }
            >
              {allChosen ? "すべて外す" : "すべて選ぶ"}
            </Button>
          </div>
          <div className="grid min-h-20 grid-cols-1 content-start gap-1.5 overflow-y-auto sm:grid-cols-2">
            {choices.classes.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-normal"
              >
                <input
                  type="checkbox"
                  name="linkClass"
                  value={item.id}
                  className="size-4 shrink-0 accent-brand"
                  checked={chosen.has(item.id)}
                  onChange={(event) => {
                    const next = new Set(chosen);
                    if (event.target.checked) next.add(item.id);
                    else next.delete(item.id);
                    setChosen(next);
                  }}
                />
                <span className="min-w-0 truncate">{item.name}</span>
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="講師(選んだクラスすべて)">
              <select
                name="linkTeacher"
                defaultValue="each"
                className={fieldClass}
              >
                <option value="each">各担当</option>
                {choices.teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="教室(選んだクラスすべて)">
              <select
                name="linkRoom"
                defaultValue="none"
                className={fieldClass}
              >
                <option value="none">ー(教室未定)</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>
      )}
      {errors.links && (
        <p role="alert" className="text-[11px] text-red-ink">
          {errors.links}
        </p>
      )}
    </div>
  );
}

// クラスの追加 (S21): そのクラスが取る教科を選び、教科ごとに講師と教室を入れる。講師は既定が「各担当」、
// 教室は既定が「ー(教室未定)」。選んだ教科の行だけに、講師と教室の選び欄が出る。
function ClassLinkFields({
  choices,
  rooms,
  errors,
}: {
  choices: ClassLinkChoices;
  rooms: { id: string; name: string }[];
  errors: FieldErrors;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const allChosen =
    choices.subjects.length > 0 && chosen.size === choices.subjects.length;
  return (
    <div
      role="group"
      aria-label="一緒に紐づける"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-lg border border-line p-3"
    >
      <p className="text-xs font-semibold">
        一緒に紐づける
        <span className="ml-2 font-normal text-muted">任意</span>
      </p>
      {choices.subjects.length === 0 ? (
        <p className="text-[11px] text-muted">有効な教科がありません。</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold">
              教科
              <span className="ml-1.5 font-normal text-muted">
                {chosen.size}/{choices.subjects.length}
              </span>
            </span>
            <Button
              size="sm"
              onClick={() =>
                setChosen(
                  allChosen
                    ? new Set()
                    : new Set(choices.subjects.map((item) => item.id)),
                )
              }
            >
              {allChosen ? "すべて外す" : "すべて選ぶ"}
            </Button>
          </div>
          <div className="flex min-h-20 flex-col gap-1.5 overflow-y-auto">
            {choices.subjects.map((item) => {
              const on = chosen.has(item.id);
              return (
                <div
                  key={item.id}
                  className="flex shrink-0 flex-col gap-2 rounded-md border border-line px-2.5 py-1.5"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
                    <input
                      type="checkbox"
                      name="clsSubject"
                      value={item.id}
                      className="size-4 shrink-0 accent-brand"
                      checked={on}
                      onChange={(event) => {
                        const next = new Set(chosen);
                        if (event.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        setChosen(next);
                      }}
                    />
                    <span className="min-w-0 truncate">{item.name}</span>
                  </label>
                  {on && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select
                        name={`clsTeacher_${item.id}`}
                        aria-label={`${item.name}の講師`}
                        defaultValue="each"
                        className={fieldClass}
                      >
                        <option value="each">講師: 各担当</option>
                        {choices.teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>
                            {teacher.name}
                          </option>
                        ))}
                      </select>
                      <select
                        name={`clsRoom_${item.id}`}
                        aria-label={`${item.name}の教室`}
                        defaultValue="none"
                        className={fieldClass}
                      >
                        <option value="none">教室: ー(教室未定)</option>
                        {rooms.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {errors.links && (
        <p role="alert" className="text-[11px] text-red-ink">
          {errors.links}
        </p>
      )}
    </div>
  );
}

function Fields({
  tab,
  row,
  rooms,
  errors,
  defaultYear,
  linkChoices,
  classLinkChoices,
}: {
  tab: Tab;
  row: EditableRow | null;
  rooms: { id: string; name: string }[];
  errors: FieldErrors;
  defaultYear: number;
  linkChoices?: SubjectLinkChoices;
  classLinkChoices?: ClassLinkChoices;
}) {
  switch (tab) {
    case "classes":
      return (
        <>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <Text
              name="name"
              label="クラス名"
              required
              errors={errors}
              defaultValue={row?.name}
            />
            <Field label="ホームルーム教室" required error={errors.homeRoomId}>
              <select
                name="homeRoomId"
                defaultValue={row?.homeRoomId ?? ""}
                className={fieldClass}
              >
                <option value="" disabled>
                  選んでください
                </option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </Field>
            <Text
              name="startYear"
              label="開始年度"
              required
              inputMode="numeric"
              errors={errors}
              defaultValue={row?.startYear ?? defaultYear}
            />
            <Text
              name="endYear"
              label="終了年度"
              inputMode="numeric"
              errors={errors}
              defaultValue={row?.endYear}
              help="空欄 = 続く"
            />
          </div>
          {row === null && classLinkChoices && (
            <ClassLinkFields
              choices={classLinkChoices}
              rooms={rooms}
              errors={errors}
            />
          )}
        </>
      );
    case "teachers":
      return (
        <>
          <Text
            name="displayName"
            label="時間割での表記"
            required
            errors={errors}
            defaultValue={row?.name}
            help="20文字まで。「各担当」「外部講師」「、」は使えません"
          />
        </>
      );
    case "subjects":
      return (
        <>
          <Text
            name="name"
            label="教科名"
            required
            errors={errors}
            defaultValue={row?.name}
          />
          {row === null && linkChoices && (
            <SubjectLinkFields
              choices={linkChoices}
              rooms={rooms}
              errors={errors}
            />
          )}
        </>
      );
    case "rooms":
      return (
        <>
          <Text
            name="name"
            label="教室名"
            required
            errors={errors}
            defaultValue={row?.name}
            help="全角数字は半角にして保存します"
          />
          <Text
            name="building"
            label="棟・階"
            errors={errors}
            defaultValue={row?.building}
          />
          <Field label="分類" required error={errors.kind}>
            <select
              name="kind"
              defaultValue={row?.kind ?? "FREE"}
              className={fieldClass}
            >
              <option value="HOMEROOM">ホームルーム</option>
              <option value="FREE">空き教室</option>
            </select>
          </Field>
          <Text
            name="note"
            label="備考"
            errors={errors}
            defaultValue={row?.note}
            help="50文字まで"
          />
        </>
      );
  }
}

// 追加 (row null) / 編集 (a row of the list)
export function MasterEditButton({
  tab,
  row,
  rooms,
  defaultYear,
  linkChoices,
  classLinkChoices,
  variant = "default",
  children,
}: {
  tab: Tab;
  row: EditableRow | null;
  rooms: { id: string; name: string }[];
  defaultYear: number;
  /** 教科の追加のとき: 一緒に紐づける、クラスと講師の候補 */
  linkChoices?: SubjectLinkChoices;
  /** クラスの追加のとき: 一緒に紐づける、教科と講師の候補 */
  classLinkChoices?: ClassLinkChoices;
  variant?: "default" | "primary";
  children: ReactNode;
}) {
  const done = useDone();
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(0);
  // 紐づけを一緒に入れる追加の窓は、広く表示する
  const wide = !row && Boolean(linkChoices || classLinkChoices);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <Button
        size={row ? "sm" : "md"}
        variant={variant}
        onClick={() => {
          setErrors({});
          setMessage(null);
          setOpened((count) => count + 1); // a fresh form each time
          dialog.current?.showModal();
        }}
      >
        {children}
      </Button>
      <dialog
        ref={dialog}
        aria-label={row ? "編集" : "追加"}
        className={`m-auto max-h-[92vh] ${wide ? "w-[min(96vw,760px)] overflow-hidden" : "w-[min(94vw,520px)] overflow-y-auto"} rounded-xl border border-line bg-white p-5 text-xs text-ink shadow-xl backdrop:bg-black/40`}
      >
        <form
          key={opened}
          className={`flex flex-col gap-4 ${wide ? "max-h-[calc(92vh-2.5rem)]" : ""}`}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const data = new FormData(event.currentTarget);
            const {
              linkClass: _classes,
              linkTeacher,
              linkRoom,
              ...rest
            } = Object.fromEntries(data);
            void _classes;
            // クラスの追加の欄 (clsSubject / clsTeacher_* / clsRoom_*) は、本体から外す
            const form = Object.fromEntries(
              Object.entries(rest).filter(([key]) => !key.startsWith("cls")),
            );
            // クラスの追加: 選んだ教科ごとの講師・教室
            const subjectLinks =
              tab === "classes" && !row
                ? data.getAll("clsSubject").map((subjectId) => ({
                    subjectId,
                    teacherId: data.get(`clsTeacher_${String(subjectId)}`),
                    roomId: data.get(`clsRoom_${String(subjectId)}`),
                  }))
                : [];
            // 教科の追加: 選んだクラスがあれば、紐づけも一緒に送る
            const classIds = data.getAll("linkClass");
            const links =
              tab === "subjects" && !row && classIds.length > 0
                ? { classIds, teacherId: linkTeacher, roomId: linkRoom }
                : subjectLinks.length > 0
                  ? { subjectLinks }
                  : {};
            setBusy(true);
            setErrors({});
            setMessage(null);
            const answer = await send("/admin/masters/save", {
              kind: tab,
              ...(row ? { id: row.id, version: row.version } : {}),
              ...form,
              ...links,
            });
            setBusy(false);
            if (answer.ok) {
              dialog.current?.close();
              done(answer.data);
            } else {
              setErrors(answer.errors);
              setMessage(answer.message);
            }
          }}
        >
          <h2 className="text-base font-bold">{row ? "編集" : "追加"}</h2>
          <Fields
            tab={tab}
            row={row}
            rooms={rooms}
            errors={errors}
            defaultYear={defaultYear}
            linkChoices={linkChoices}
            classLinkChoices={classLinkChoices}
          />
          {message && (
            <p role="alert" className="text-[11px] text-red-ink">
              {message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => dialog.current?.close()} disabled={busy}>
              閉じる
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              保存
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

// 無効にする (MC501) / 有効に戻す (確認なし)
export function MasterActiveButton({
  tab,
  id,
  name,
  active,
}: {
  tab: Tab;
  id: string;
  name: string;
  active: boolean;
}) {
  const done = useDone();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (): Promise<string | null> => {
    const answer = await send("/admin/masters/active", {
      kind: tab,
      id,
      active: !active,
    });
    if (answer.ok) {
      done(answer.data);
      return null;
    }
    router.refresh();
    return answer.message ?? SYSTEM_ERROR_MESSAGE;
  };

  return active ? (
    <ConfirmButton
      size="sm"
      variant="danger"
      message={MESSAGES.MC501(name)}
      onConfirm={change}
    >
      無効にする
    </ConfirmButton>
  ) : (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(await change());
          setBusy(false);
        }}
      >
        有効に戻す
      </Button>
      {error && (
        <span role="alert" className="text-[11px] text-red-ink">
          {error}
        </span>
      )}
    </span>
  );
}
