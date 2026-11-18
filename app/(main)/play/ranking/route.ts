import type { NextRequest } from "next/server";
import { LOGIN_ERROR_MESSAGES, SYSTEM_ERROR_MESSAGE } from "@/lib/messages";
import { json } from "@/lib/server/admin-request";
import { loadBoard } from "@/lib/server/mini-game-ranking";
import { fromThisSite } from "@/lib/server/same-site";
import { getCurrentUser } from "@/lib/server/session";

// ミニゲームのランキングを返す (?mode=normal&difficulty=hard)。学生と時間割管理者だけ。
// 返すのは、ニックネームと記録と順位だけ。
export async function GET(request: NextRequest): Promise<Response> {
  if (!fromThisSite(request))
    return json(404, { message: SYSTEM_ERROR_MESSAGE });
  const user = await getCurrentUser();
  if (user === null) {
    return json(401, { message: LOGIN_ERROR_MESSAGES.ME005 });
  }
  const params = request.nextUrl.searchParams;
  try {
    const board = await loadBoard(
      user,
      params.get("mode"),
      params.get("difficulty"),
    );
    if (board === null) return json(404, { message: SYSTEM_ERROR_MESSAGE });
    return json(200, board);
  } catch (error) {
    console.error("mini game ranking failed", error);
    return json(500, { message: SYSTEM_ERROR_MESSAGE });
  }
}
