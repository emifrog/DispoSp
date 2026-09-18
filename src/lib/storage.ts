// Browser storage keys of the demonstration, shared by the provider and the
// error screens so a recovery action never drifts from what the app writes.
export const STATE_KEY = "disposp-demo-v1";
export const ACTOR_KEY = "disposp-demo-actor";

export function clearDemoStorage() {
  try {
    localStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(ACTOR_KEY);
  } catch {
    // Storage can be blocked entirely; the caller reloads on the seeded demo anyway.
  }
}
