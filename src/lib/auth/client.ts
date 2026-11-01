import type { PublicUser } from "./types";

const HINT_KEY = "aisle-signed-in";
const hintListeners = new Set<() => void>();
let hintRaw: string | null | undefined;
let hintSnapshot: PublicUser | null = null;

function parseHint(raw: string | null): PublicUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PublicUser>;
    if (!parsed.id || !parsed.email || !parsed.name) return null;
    if (parsed.role !== "dev" && parsed.role !== "beta") return null;
    return { id: parsed.id, email: parsed.email, name: parsed.name, role: parsed.role };
  } catch {
    return null;
  }
}

/** The last account this browser signed into. Used to paint the studio before the database answers. */
export function readSignedInHint(): PublicUser | null {
  try {
    const next = localStorage.getItem(HINT_KEY);
    if (next === hintRaw) return hintSnapshot;
    hintRaw = next;
    hintSnapshot = parseHint(next);
    return hintSnapshot;
  } catch {
    return null;
  }
}

export function subscribeSignedInHint(onChange: () => void) {
  hintListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    hintListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function rememberSignedIn(user: PublicUser) {
  const next = JSON.stringify({ id: user.id, email: user.email, name: user.name, role: user.role });
  if (next === hintRaw && hintSnapshot) return;
  try {
    localStorage.setItem(HINT_KEY, next);
  } catch {
    // Private mode can refuse storage. The session cookie still signs the next request in.
  }
  hintRaw = next;
  hintSnapshot = { id: user.id, email: user.email, name: user.name, role: user.role };
  hintListeners.forEach((listener) => listener());
}

export function clearSignedInHint() {
  try {
    localStorage.removeItem(HINT_KEY);
  } catch {
    // Nothing stored to clear.
  }
  hintRaw = null;
  hintSnapshot = null;
  hintListeners.forEach((listener) => listener());
}

/** Browser-only: end the session and reload so no in-memory workspace survives. */
export async function signOutAndReload(): Promise<void> {
  clearSignedInHint();
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* offline: the cookie may survive, so fall through to the redirect and let the proxy decide */
  }
  // A full navigation drops the in-memory workspace so the next account never sees it.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
}
