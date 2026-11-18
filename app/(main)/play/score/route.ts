import type { NextRequest } from "next/server";
import { SYSTEM_ERROR_MESSAGE } from "@/lib/messages";
import { json } from "@/lib/server/admin-request";
import { authorize, readJson } from "@/lib/server/action-request";
import { submitScore } from "@/lib/server/mini-game-ranking";

// ミニゲームのランキングへ、記録を登録する (隠し要素。学生と時間割管理者だけ)。
// 遊べない役割 (先生) には、ページと同じに、ないものとして答える (404)。
export async function POST(request: NextRequest): Promise<Response> {
  const allowed = await authorize(request, "student");
  if ("refusal" in allowed) return allowed.refusal;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  try {
    const result = await submitScore(allowed.user, body);
    if (result.kind === "forbidden") {
      return json(404, { message: SYSTEM_ERROR_MESSAGE });
    }
    if (result.kind === "invalid") {
      return json(400, { message: result.message });
    }
    if (result.kind === "not_best") {
      return json(200, { kind: "not_best", best: result.best });
    }
    return json(200, { kind: "saved", rank: result.rank });
  } catch (error) {
    console.error("mini game score failed", error);
    return json(500, { message: SYSTEM_ERROR_MESSAGE });
  }
}
