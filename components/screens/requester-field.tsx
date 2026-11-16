"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/form";
import { REQUESTER_NAME_MAX } from "@/lib/domain/reservation-core";

// S12 代理入力の「依頼者」。登録済みの生徒は、名前で探して選べる (選ぶと、その生徒の「自分の予約」に
// 出る)。一覧にいない人 (まだログインしたことのない生徒など) は、名前を文字で入れる。
// サーバーが、選んだ人も名前も、もう一度確かめる。

type Person = { id: string; name: string };
export type RequesterValue = { id: string | null; text: string };

const MIN_QUERY = 2;
const DELAY_MS = 300;

async function search(query: string): Promise<Person[]> {
  try {
    const response = await fetch("/teacher/reservations/requesters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: query }),
    });
    if (!response.ok) return [];
    const data: unknown = await response.json().catch(() => null);
    const people =
      typeof data === "object" && data !== null && "people" in data
        ? (data as { people: unknown }).people
        : [];
    return Array.isArray(people)
      ? people.filter(
          (item): item is Person =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as Person).id === "string" &&
            typeof (item as Person).name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function RequesterField({
  value,
  onChange,
  error,
}: {
  value: RequesterValue;
  onChange: (next: RequesterValue) => void;
  error?: string;
}) {
  const inputId = useId();
  const [candidates, setCandidates] = useState<Person[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 古い検索の答えが、新しい入力のあとに届いても、使わない
  const latest = useRef(0);

  const typed = (text: string) => {
    onChange({ id: null, text });
    clearTimeout(timer.current);
    const query = text.trim();
    latest.current += 1;
    const mine = latest.current;
    if ([...query].length < MIN_QUERY) {
      setCandidates([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const found = await search(query);
      if (latest.current === mine) setCandidates(found);
    }, DELAY_MS);
  };

  const choose = (person: Person) => {
    clearTimeout(timer.current);
    latest.current += 1;
    setCandidates([]);
    onChange({ id: person.id, text: person.name });
  };

  const release = () => {
    onChange({ id: null, text: value.text });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold sm:col-span-2">
      <label htmlFor={inputId}>
        依頼者
        <span className="ml-1.5 text-[11px] text-[#a3101f]">必須</span>
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={value.text}
          readOnly={value.id !== null}
          maxLength={REQUESTER_NAME_MAX}
          autoComplete="off"
          placeholder="例: 大学併修2年 山田"
          onChange={(event) => typed(event.target.value)}
          className={`${fieldClass} ${value.id !== null ? "bg-[#edf0f5]" : ""}`}
        />
        {value.id !== null && (
          <Button size="sm" onClick={release}>
            選び直す
          </Button>
        )}
      </div>
      {value.id !== null ? (
        <span className="text-[11px] font-normal text-muted">
          登録されている生徒を選びました。この生徒の「自分の予約」に、代理入力として出ます。
        </span>
      ) : (
        <>
          {candidates.length > 0 && (
            <ul
              aria-label="登録されている生徒"
              className="flex flex-col overflow-hidden rounded-[7px] border border-line bg-white font-normal"
            >
              {candidates.map((person) => (
                <li
                  key={person.id}
                  className="border-b border-line last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => choose(person)}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-[#f6f8fc]"
                  >
                    {person.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <span className="text-[11px] font-normal text-muted">
            登録されている生徒は、名前で探して選べます(選ぶと、その生徒の「自分の予約」にも出ます)。
            一覧にいない人は、そのまま名前を入れてください({REQUESTER_NAME_MAX}
            文字まで)。
          </span>
        </>
      )}
      {error && (
        <span role="alert" className="text-[11px] font-normal text-red-ink">
          {error}
        </span>
      )}
    </div>
  );
}
