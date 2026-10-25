/** Browser-only: end the session and reload so no in-memory workspace survives. */
export async function signOutAndReload(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* offline: the cookie may survive, so fall through to the redirect and let the proxy decide */
  }
  // A full navigation drops the in-memory workspace so the next account never sees it.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
}
