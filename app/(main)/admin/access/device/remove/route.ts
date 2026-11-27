import type { NextRequest } from "next/server";
import { adminPost } from "@/lib/server/admin-route";
import { removeDevice } from "@/lib/server/devices";

// S25 機器: 機器の行を消す(教室との結びつけを外す)。時間割管理者 only.
export function POST(request: NextRequest): Promise<Response> {
  return adminPost(request, "device remove", (body) => removeDevice(body.id));
}
