import type { NextRequest } from "next/server";
import { MAX_SYNC_BYTES, deviceSyncSchema } from "@/lib/domain/device-sync";
import { applyDeviceSync } from "@/lib/server/devices";
import { gatewayConfig, isDatabaseUnavailable } from "@/lib/server/gateway";
import { authenticateGateway } from "@/lib/server/gateway-auth";

// 機器の生存通知 (外部設計書 14-17): 校内 PC の中継が、1 分ごとに、機器 (教室側の ESP32) から届いた
// 最新の時刻を送り、登録済みの機器の対応表 (espMac → 受信機ID) を受け取る。位置のイベント
// (location-events) と同じ鍵と ID で認証する。答えは、1 つの形の JSON で、鍵・DB・コードのことは言わない。

type ErrorCode =
  | "invalid_json"
  | "invalid_request_body"
  | "gateway_id_mismatch"
  | "unauthorized"
  | "gateway_disabled"
  | "payload_too_large"
  | "database_unavailable"
  | "internal_server_error";

const STATUS: Record<ErrorCode, number> = {
  invalid_json: 400,
  invalid_request_body: 400,
  gateway_id_mismatch: 400,
  unauthorized: 401,
  gateway_disabled: 403,
  payload_too_large: 413,
  database_unavailable: 503,
  internal_server_error: 500,
};

function respond(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const failure = (error: ErrorCode) =>
  respond(STATUS[error], { success: false, error });

/** One line for the log. Never the key, the Authorization header or a MAC. */
function log(fields: Record<string, unknown>) {
  console.info(JSON.stringify({ at: "gateway.device-sync", ...fields }));
}

export async function POST(request: NextRequest): Promise<Response> {
  const started = Date.now();
  const done = (response: Response, fields: Record<string, unknown> = {}) => {
    log({ status: response.status, ms: Date.now() - started, ...fields });
    return response;
  };

  // 1. Who is asking. Nothing is read and nothing is written before this passes.
  let auth: ReturnType<typeof authenticateGateway>;
  try {
    auth = authenticateGateway(request.headers, gatewayConfig());
  } catch {
    return done(failure("internal_server_error"));
  }
  if (auth === "disabled") return done(failure("gateway_disabled"));
  if (auth === "unauthorized") return done(failure("unauthorized"));

  // 2. The size, before the body is read, and again after.
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_SYNC_BYTES) return done(failure("payload_too_large"));
  if (
    !(request.headers.get("content-type") ?? "").startsWith("application/json")
  ) {
    return done(failure("invalid_request_body"));
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_SYNC_BYTES) {
    return done(failure("payload_too_large"));
  }

  // 3. The body.
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return done(failure("invalid_json"));
  }
  const parsed = deviceSyncSchema.safeParse(json);
  if (!parsed.success) return done(failure("invalid_request_body"));
  const sync = parsed.data;
  if (sync.gatewayId !== request.headers.get("x-gateway-id")) {
    return done(failure("gateway_id_mismatch"));
  }

  // 4. Save, and answer with the table of registered devices.
  try {
    const { registered } = await applyDeviceSync(sync, new Date());
    return done(respond(200, { success: true, registered }), {
      gatewayId: sync.gatewayId,
      received: sync.devices.length,
      registered: registered.length,
    });
  } catch (error) {
    const unavailable = isDatabaseUnavailable(error);
    console.error(
      "gateway device sync failed",
      error instanceof Error ? error.name : "unknown",
    );
    return done(
      failure(unavailable ? "database_unavailable" : "internal_server_error"),
      { gatewayId: sync.gatewayId },
    );
  }
}
