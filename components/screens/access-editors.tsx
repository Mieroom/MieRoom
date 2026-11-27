"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { fieldClass } from "@/components/ui/form";
import { MESSAGES, SYSTEM_ERROR_MESSAGE } from "@/lib/messages";

// S25: the editing parts. The server checks every value again (and the database refuses a
// duplicate), so the messages shown here are the server's.

export async function send(
  endpoint: string,
  body: unknown,
): Promise<{ ok: boolean; notice: string | null; message: string | null }> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json().catch(() => null);
    const record =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : {};
    return {
      ok: response.ok,
      notice: typeof record.notice === "string" ? record.notice : null,
      message:
        typeof record.message === "string"
          ? record.message
          : response.ok
            ? null
            : SYSTEM_ERROR_MESSAGE,
    };
  } catch {
    return { ok: false, notice: null, message: MESSAGES.ME901 };
  }
}

/** Shows what was done (MI501) on this screen and reads the lists again. */
export function useDone() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (notice: string | null) => {
    const params = new URLSearchParams(search);
    if (notice) params.set("notice", notice);
    router.replace(`${pathname}?${params.toString()}`);
    router.refresh();
  };
}

const inputClass = `${fieldClass} h-[34px] w-[130px]`;

// タグID of one 講師: save, or remove with an empty box
export function TagEditor({
  teacherId,
  tagId,
}: {
  teacherId: string;
  tagId: string | null;
}) {
  const done = useDone();
  const [value, setValue] = useState(tagId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string) => {
    setBusy(true);
    setError(null);
    const answer = await send("/admin/access/tag", {
      teacherId,
      tagId: next,
    });
    setBusy(false);
    if (answer.ok) {
      setValue(next);
      done(answer.notice);
    } else {
      setError(answer.message);
    }
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void save(value);
      }}
    >
      <input
        aria-label="タグID"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={inputClass}
        placeholder="例: 12"
      />
      <Button
        type="submit"
        size="sm"
        variant="primary"
        disabled={busy || value === (tagId ?? "")}
      >
        保存
      </Button>
      {tagId && (
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => void save("")}
        >
          外す
        </Button>
      )}
      {error && (
        <span role="alert" className="basis-full text-[11px] text-red-ink">
          {error}
        </span>
      )}
    </form>
  );
}

// 受信機 を足す: the ID the gateway sends, and the room it is in
export function ReceiverAddForm({
  rooms,
}: {
  rooms: { id: string; name: string }[];
}) {
  const done = useDone();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiverId, setReceiverId] = useState("");

  return (
    <form
      className="mb-4 flex flex-wrap items-end gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setError(null);
        const answer = await send("/admin/access/receiver", {
          roomId: form.get("room"),
          receiverId,
        });
        setBusy(false);
        if (answer.ok) {
          setReceiverId("");
          done(answer.notice);
        } else {
          setError(answer.message);
        }
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-semibold">
        受信機ID
        <input
          value={receiverId}
          onChange={(event) => setReceiverId(event.target.value)}
          autoComplete="off"
          className={inputClass}
          placeholder="例: 304"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        教室
        <select
          name="room"
          defaultValue=""
          required
          className={`${fieldClass} h-[34px] w-[180px]`}
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
      </label>
      <Button type="submit" size="sm" variant="primary" disabled={busy}>
        登録する
      </Button>
      {error && (
        <span role="alert" className="basis-full text-[11px] text-red-ink">
          {error}
        </span>
      )}
    </form>
  );
}

// 機器 (教室側の ESP32) を、教室の受信機ID に結びつける。登録も、付け替えも、同じ操作 (14-17)。
// 受信機ID は、選んだ教室にすでにあるものから選ぶか、新しく入力する (新しい ID は、S25 の受信機にも登録される)。
export function DeviceAssignForm({
  id,
  rooms,
  receivers,
  current,
  submitLabel,
}: {
  id: string;
  rooms: { id: string; name: string }[];
  receivers: { receiverId: string; roomId: string }[];
  /** 登録済みの機器を付け替えるときの、いまの教室と受信機ID */
  current?: { roomId: string; receiverId: string };
  submitLabel: string;
}) {
  const done = useDone();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState(current?.roomId ?? "");
  const [receiverId, setReceiverId] = useState(current?.receiverId ?? "");
  const listId = `receivers-of-${id}`;
  const unchanged =
    current !== undefined &&
    roomId === current.roomId &&
    receiverId.trim() === current.receiverId;

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        const answer = await send("/admin/access/device", {
          id,
          roomId,
          receiverId,
        });
        setBusy(false);
        if (answer.ok) done(answer.notice);
        else setError(answer.message);
      }}
    >
      <select
        aria-label="教室"
        value={roomId}
        onChange={(event) => setRoomId(event.target.value)}
        required
        className={`${fieldClass} h-[34px] w-[150px]`}
      >
        <option value="" disabled>
          教室を選ぶ
        </option>
        {rooms.map((room) => (
          <option key={room.id} value={room.id}>
            {room.name}
          </option>
        ))}
      </select>
      <input
        aria-label="受信機ID"
        list={listId}
        value={receiverId}
        onChange={(event) => setReceiverId(event.target.value)}
        autoComplete="off"
        required
        className={inputClass}
        placeholder="受信機ID(例: 304)"
      />
      <datalist id={listId}>
        {receivers
          .filter((receiver) => receiver.roomId === roomId)
          .map((receiver) => (
            <option key={receiver.receiverId} value={receiver.receiverId} />
          ))}
      </datalist>
      <Button
        type="submit"
        size="sm"
        variant="primary"
        disabled={busy || unchanged || roomId === ""}
      >
        {submitLabel}
      </Button>
      {error && (
        <span role="alert" className="basis-full text-[11px] text-red-ink">
          {error}
        </span>
      )}
    </form>
  );
}

// 機器を外す(行を消す)。heartbeat が続けば、また「未登録」に現れる。確認の窓(MC506)を出す。
export function DeviceRemoveButton({
  id,
  registered,
}: {
  id: string;
  registered: boolean;
}) {
  const done = useDone();
  const router = useRouter();
  return (
    <ConfirmButton
      size="sm"
      variant="danger"
      message={registered ? MESSAGES.MC506 : MESSAGES.MC506unregistered}
      confirmLabel="外す"
      onConfirm={async () => {
        const answer = await send("/admin/access/device/remove", { id });
        if (answer.ok) {
          done(answer.notice);
          return null;
        }
        router.refresh();
        return answer.message ?? SYSTEM_ERROR_MESSAGE;
      }}
    >
      外す
    </ConfirmButton>
  );
}

export function ReceiverRemoveButton({ id }: { id: string }) {
  const done = useDone();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const answer = await send("/admin/access/receiver/remove", { id });
          setBusy(false);
          if (answer.ok) done(answer.notice);
          else {
            setError(answer.message);
            router.refresh();
          }
        }}
      >
        外す
      </Button>
      {error && (
        <span role="alert" className="text-[11px] text-red-ink">
          {error}
        </span>
      )}
    </span>
  );
}
