import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MESSAGES } from "@/lib/messages";
import { testDb, closeDatabase, resetDatabase } from "./support/db";
import {
  ID,
  ROOM_FREE_NAME,
  USERS,
  seedBase,
  type TestRole,
} from "./support/fixtures";

// タグ・受信機(S25。T-ACC、テスト設計書 4-6, 11-9): the routes, the server functions and a real database.
// 基準の「いま」は 2026-11-10(火)10:00 JST。本文は、画面(admin-views.tsx)が送る形のまま:
//   タグ: { teacherId, tagId }(空にして保存すると、タグを外す)、受信機の追加: { roomId, receiverId }、
//   受信機の削除: { id }。S05(先生一覧)の位置の表示は、画面が使う loadTeacherDirectory で確かめる。
// 期待値は、外部設計書(06-3 の S25、規則 R7-2・R7-3、メッセージ ME509・ME513・ME514・MI501)と
// テスト設計書から書いた(tests/cases/access.cases.ts と同じ内容)。
// 設計書が応答コードまでは決めていない拒否は、「受け付けない(エラーの応答。DB は変わらない)」だけを確かめる。

vi.mock("server-only", () => ({}));
type TestUser = { id: string; name: string; role: TestRole };
const session = vi.hoisted(() => ({ user: null as null | TestUser }));
vi.mock("@/lib/server/session", async () => {
  const { hasRole } = await import("./support/session");
  return {
    getCurrentUser: async () => session.user,
    hasRole,
    hasFreshSession: async () => true,
  };
});
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./support/db");
  return { getDb: () => testDb() };
});

import { POST as receiverAdd } from "@/app/(main)/admin/access/receiver/route";
import { POST as receiverRemove } from "@/app/(main)/admin/access/receiver/remove/route";
import { POST as tagSave } from "@/app/(main)/admin/access/tag/route";
import { loadTeacherDirectory } from "@/lib/server/queries/common";

const HOST = "mieroom.example";
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";
const TEACHER = {
  suzuki: "00000000-0000-4000-8000-000000000121",
  retired: "00000000-0000-4000-8000-000000000122", // 無効
} as const;
const ROOM = {
  old: "00000000-0000-4000-8000-000000000141", // 無効
} as const;

const at = (jst: string) => vi.setSystemTime(new Date(`${jst}:00+09:00`));

function request(path: string, body: unknown) {
  return new NextRequest(`https://${HOST}${path}`, {
    method: "POST",
    headers: {
      host: HOST,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
type Answer = { notice?: string; message?: string };
const answerOf = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Answer,
});

const setTag = async (teacherId: unknown, tagId: unknown) =>
  answerOf(await tagSave(request("/admin/access/tag", { teacherId, tagId })));
const addReceiver = async (roomId: unknown, receiverId: unknown) =>
  answerOf(
    await receiverAdd(
      request("/admin/access/receiver", { roomId, receiverId }),
    ),
  );
const removeReceiver = async (id: unknown) =>
  answerOf(
    await receiverRemove(request("/admin/access/receiver/remove", { id })),
  );

const db = () => testDb();
const tagOf = async (id: string) =>
  (await db().teacher.findUniqueOrThrow({ where: { id } })).tagId;
const refused = (result: { status: number }) => {
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(result.status).toBeLessThan(500);
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T10:00");
  await resetDatabase();
  await seedBase(); // 講師「田村」はタグ 12、教室「展示室」「101」
  await db().teacher.createMany({
    data: [
      { id: TEACHER.suzuki, displayName: "鈴木" },
      {
        id: TEACHER.retired,
        displayName: "退職者",
        active: false,
        tagId: "99",
      },
    ],
  });
  await db().room.create({
    data: { id: ROOM.old, name: "旧教室", kind: "FREE", active: false },
  });
  session.user = USERS.admin;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDatabase();
});

/** 田村の位置を、教室「展示室」で検知されている状態にする。 */
const placeTamura = () =>
  db().location.create({
    data: {
      teacherId: ID.teacher,
      roomId: ID.roomFree,
      status: "DETECTED",
      lastEventId: "00000000-0000-4000-8000-0000000000e1",
      lastOccurredAt: new Date("2026-11-10T09:55:00+09:00"),
      updatedAt: new Date("2026-11-10T09:55:00+09:00"),
    },
  });
const tamuraView = async () => {
  const rows = await loadTeacherDirectory(2026, "");
  return rows.find((row) => row.id === ID.teacher)?.location;
};

describe("タグID(講師)", () => {
  it("T-ACC-001a タグ ID は 0〜65535 の整数で登録できる(MI501)。先頭の 0 は付けず、前後の空白は取る", async () => {
    for (const [typed, stored] of [
      ["0", "0"],
      ["65535", "65535"],
      [" 7 ", "7"],
      ["007", "7"],
    ] as const) {
      const result = await setTag(TEACHER.suzuki, typed);
      expect([typed, result.status, result.body.notice]).toEqual([
        typed,
        200,
        "MI501",
      ]);
      expect(await tagOf(TEACHER.suzuki), typed).toBe(stored);
    }
  });

  it("T-ACC-001b 範囲外・数字でないものは ME513。保存しない", async () => {
    await setTag(TEACHER.suzuki, "5");
    for (const typed of [
      "65536",
      "99999",
      "123456",
      "-1",
      "1.5",
      "abc",
      "12a",
      "1e3",
      "0x10",
    ]) {
      const result = await setTag(TEACHER.suzuki, typed);
      expect([typed, result.status, result.body.message]).toEqual([
        typed,
        400,
        MESSAGES.ME513,
      ]);
    }
    expect(await tagOf(TEACHER.suzuki)).toBe("5");
  });

  it("T-ACC-001c 同じタグ ID は、ほかの講師に登録できない(ME509)。自分の同じ値の保存は、そのまま通る", async () => {
    // 田村がタグ 12
    const duplicate = await setTag(TEACHER.suzuki, "12");
    expect([duplicate.status, duplicate.body.message]).toEqual([
      400,
      MESSAGES.ME509,
    ]);
    expect(await tagOf(TEACHER.suzuki)).toBeNull();
    // 前後の空白・先頭の 0 があっても、同じ値は重複
    const spelled = await setTag(TEACHER.suzuki, " 012 ");
    expect([spelled.status, spelled.body.message]).toEqual([
      400,
      MESSAGES.ME509,
    ]);
    const same = await setTag(ID.teacher, "12");
    expect([same.status, same.body.notice]).toEqual([200, "MI501"]);
  });

  it("T-ACC-001d 無効な講師・いない講師・形の違う本文は、受け付けない(エラーの応答。DB は変わらない)", async () => {
    refused(await setTag(TEACHER.retired, "100")); // 無効な講師は、編集できない
    expect(await tagOf(TEACHER.retired)).toBe("99");
    refused(await setTag(MISSING_ID, "100"));
    refused(await setTag("not-a-uuid", "100"));
    refused(await setTag(undefined, "100"));
    refused(await setTag(TEACHER.suzuki, 100)); // 数字そのもの(文字でない)
    refused(await setTag(TEACHER.suzuki, { value: "100" }));
    expect(await tagOf(TEACHER.suzuki)).toBeNull();
  });

  it("T-ACC-003a タグを変える・外すと、その講師のいまの位置が消える(S05 は 検知エリア外 → 位置情報なし)", async () => {
    await placeTamura();
    expect(await tamuraView()).toEqual({ kind: "room", room: ROOM_FREE_NAME });

    // 変える: 古いタグの位置は消える。新しいタグでは、まだ何も届いていない
    const changed = await setTag(ID.teacher, "13");
    expect(changed.status).toBe(200);
    expect(await db().location.count()).toBe(0);
    expect(await tamuraView()).toEqual({ kind: "out-of-area" });

    // 外す(空にして保存する): タグがない
    await placeTamura();
    const removed = await setTag(ID.teacher, "");
    expect([removed.status, removed.body.notice]).toEqual([200, "MI501"]);
    expect(await tagOf(ID.teacher)).toBeNull();
    expect(await db().location.count()).toBe(0);
    expect(await tamuraView()).toEqual({ kind: "no-tag" });
    // 外したタグは、ほかの講師が使える
    expect((await setTag(TEACHER.suzuki, "12")).status).toBe(200);
  });

  it("T-ACC-003b 同じ値で保存したときは、何もしない(位置は消えない)", async () => {
    await placeTamura();
    const same = await setTag(ID.teacher, "12");
    expect([same.status, same.body.notice]).toEqual([200, "MI501"]);
    expect(await db().location.count()).toBe(1);
    expect(await tamuraView()).toEqual({ kind: "room", room: ROOM_FREE_NAME });
    // 余分な空白や 0 の違いがあっても、同じ値
    await setTag(ID.teacher, " 012 ");
    expect(await db().location.count()).toBe(1);
  });
});

describe("受信機ID(教室)", () => {
  it("T-ACC-002a 受信機 ID は、半角の英数字と . _ - で 64 文字まで(MI501)。それ以外は ME514", async () => {
    const valid = ["304", "a", "A-b_c.d", "x".repeat(64)];
    for (const receiverId of valid) {
      const result = await addReceiver(ID.roomFree, receiverId);
      expect([receiverId, result.status, result.body.notice]).toEqual([
        receiverId,
        200,
        "MI501",
      ]);
    }
    const invalid = ["x".repeat(65), "a b", "a/b", "a;b", "é", "あ", "a,b"];
    for (const receiverId of invalid) {
      const result = await addReceiver(ID.roomFree, receiverId);
      expect([receiverId.length, result.status, result.body.message]).toEqual([
        receiverId.length,
        400,
        MESSAGES.ME514,
      ]);
    }
    expect(await db().receiver.count()).toBe(valid.length);
  });

  it("T-ACC-002b 同じ受信機 ID は、全教室で重複できない(ME509)", async () => {
    expect((await addReceiver(ID.roomFree, "304")).status).toBe(200);
    const sameRoom = await addReceiver(ID.roomFree, "304");
    expect([sameRoom.status, sameRoom.body.message]).toEqual([
      400,
      MESSAGES.ME509,
    ]);
    const otherRoom = await addReceiver(ID.roomHome, "304");
    expect([otherRoom.status, otherRoom.body.message]).toEqual([
      400,
      MESSAGES.ME509,
    ]);
    expect(await db().receiver.count()).toBe(1);
  });

  it("T-ACC-002c 無効な教室・いない教室・形の違う本文には、登録しない(エラーの応答)", async () => {
    refused(await addReceiver(ROOM.old, "400"));
    refused(await addReceiver(MISSING_ID, "400"));
    refused(await addReceiver("not-a-uuid", "400"));
    refused(await addReceiver(ID.roomFree, 400)); // 数字そのもの
    refused(await addReceiver(ID.roomFree, undefined));
    expect(await db().receiver.count()).toBe(0);
  });

  it("T-ACC-004 1 つの教室に、受信機 ID を複数登録できる。同じ受信機 ID を別の教室には登録できない(ME509)", async () => {
    expect((await addReceiver(ID.roomFree, "304")).status).toBe(200);
    expect((await addReceiver(ID.roomFree, "305")).status).toBe(200);
    expect(await db().receiver.count({ where: { roomId: ID.roomFree } })).toBe(
      2,
    );
    const other = await addReceiver(ID.roomHome, "305");
    expect([other.status, other.body.message]).toEqual([400, MESSAGES.ME509]);
    expect(await db().receiver.count({ where: { roomId: ID.roomHome } })).toBe(
      0,
    );
  });

  it("T-ACC-005 受信機の登録を外せる(MI501)。その 1 件だけが消え、同じ教室のほかの受信機は残る。もうない登録は断る", async () => {
    await addReceiver(ID.roomFree, "304");
    await addReceiver(ID.roomFree, "305");
    const target = await db().receiver.findFirstOrThrow({
      where: { receiverId: "304" },
    });
    const removed = await removeReceiver(target.id);
    expect([removed.status, removed.body.notice]).toEqual([200, "MI501"]);
    const left = await db().receiver.findMany();
    expect(left.map((row) => row.receiverId)).toEqual(["305"]);
    // もう一度・いない ID・形の違う ID
    expect((await removeReceiver(target.id)).body.message).toBe(MESSAGES.ME902);
    refused(await removeReceiver(MISSING_ID));
    refused(await removeReceiver("not-a-uuid"));
    expect(await db().receiver.count()).toBe(1);
    // 外した受信機 ID は、また登録できる
    expect((await addReceiver(ID.roomHome, "304")).status).toBe(200);
  });
});
