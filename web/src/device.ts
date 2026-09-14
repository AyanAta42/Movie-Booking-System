/// Identity without auth.
///
/// One UUID per browser, generated on first load and kept in localStorage. It is
/// sent as `X-Device-Id` on every request and the API treats it as the user id.
/// So a phone and a laptop are two different people, which is the whole point —
/// a single shared test user would make it impossible to see one device
/// interfere with another.
///
/// Two tabs in the same browser share this, so they are the same person. Use two
/// different browsers or two devices to test interference.
const KEY = "mbp.deviceId";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private mode, or storage blocked. Fall through to a per-session id.
    return null;
  }
}

/// A v4 UUID that works over plain HTTP on a LAN address.
///
/// `crypto.randomUUID()` is restricted to secure contexts. localhost counts as
/// one, so it works on the dev machine and then throws on a phone hitting
/// http://192.168.x.x — which took down the whole app, because App renders the
/// device id. `crypto.getRandomValues` carries no such restriction, so the UUID
/// is assembled from it and randomUUID is only a fast path.
function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // Last resort. Not cryptographically sound, but this id only needs to be
    // unique across a handful of devices, not unguessable.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let cached: string | null = null;

export function deviceId(): string {
  if (cached) return cached;

  const stored = read();
  if (stored) {
    cached = stored;
    return cached;
  }

  const fresh = newUuid();
  try {
    localStorage.setItem(KEY, fresh);
  } catch {
    // Not persisted. The id still works for this page's lifetime; a reload just
    // becomes a new "device", which is survivable for a dev build.
  }
  cached = fresh;
  return cached;
}

/// Shown in the header so you can tell two browsers apart at a glance while
/// testing, and so a hold that "vanished" is explainable by the device changing.
export function shortDeviceId(): string {
  return deviceId().slice(0, 8);
}
