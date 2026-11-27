import type { NextRequest } from "next/server";
import { adminPost } from "@/lib/server/admin-route";
import { assignDevice } from "@/lib/server/devices";

// S25 機器: 機器を、教室の受信機ID に結びつける(登録も、付け替えも)。時間割管理者 only.
export function POST(request: NextRequest): Promise<Response> {
  return adminPost(request, "device assign", (body) =>
    assignDevice(body.id, body.roomId, body.receiverId),
  );
}
