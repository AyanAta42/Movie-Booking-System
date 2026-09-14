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

let cached: string | null = null;

export function deviceId(): string {
  if (cached) return cached;

  const stored = read();
  if (stored) {
    cached = stored;
    return cached;
  }

  const fresh = crypto.randomUUID();
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
