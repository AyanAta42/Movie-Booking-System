import { randomUUID } from "node:crypto";
import { baseUrl } from "./server";

export type ApiResponse<T = any> = {
  status: number;
  body: T;
  /// The API's error code ("conflict", "gone", …) when this is a 4xx/5xx.
  code: string | null;
};

/// A fresh device id is a fresh user. Two callers must never share one, or they
/// are the same person and the idempotency constraint silently merges them.
export function newDevice(): string {
  return randomUUID();
}

async function send<T>(
  path: string,
  deviceId: string,
  init?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
      ...init?.headers,
    },
  });

  const body = await res.json().catch(() => null);
  return {
    status: res.status,
    body: body as T,
    code: body && typeof body.error === "string" ? body.error : null,
  };
}

export function reserve(
  deviceId: string,
  showId: string,
  seatIds: string[],
  idempotencyKey = randomUUID()
) {
  return send("/reservations", deviceId, {
    method: "POST",
    body: JSON.stringify({ showId, seatIds, idempotencyKey }),
  });
}

export function confirm(deviceId: string, holdId: string) {
  return send(`/reservations/${holdId}/confirm`, deviceId, { method: "POST" });
}

export function getReservation(deviceId: string, holdId: string) {
  return send(`/reservations/${holdId}`, deviceId);
}
