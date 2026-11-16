import type { NextRequest } from "next/server";
import { SYSTEM_ERROR_MESSAGE } from "@/lib/messages";
import { json } from "@/lib/server/admin-request";
import { authorize, readJson } from "@/lib/server/action-request";
import { searchRequesters } from "@/lib/server/requesters";

// S12 依頼者の検索: 名前に、ことばを含む生徒 (最大10人)。先生 (時間割管理者を含む) だけ。
// 返すのは、ID と名前だけ。メールは返さない。
export async function POST(request: NextRequest): Promise<Response> {
  const allowed = await authorize(request, "teacher");
  if ("refusal" in allowed) return allowed.refusal;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const query =
    typeof body === "object" && body !== null && "q" in body
      ? (body as { q: unknown }).q
      : undefined;
  try {
    return json(200, {
      people: await searchRequesters(query, allowed.user.id),
    });
  } catch (error) {
    console.error("requester search failed", error);
    return json(500, { message: SYSTEM_ERROR_MESSAGE });
  }
}
