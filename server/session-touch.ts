// express-session "touches" the store on every request that didn't change the
// session, to push its expiry forward: with Postgres that is one UPDATE per
// API request, about 75 a minute for one open dashboard. The expiry is a day
// away, so moving it at most once a minute per session is just as good.
//
//   request ─► store.touch(sid) ─┬─ touched < intervalMs ago → skip (callback only)
//                                └─ otherwise → the real UPDATE, remember when
//
// The cookie itself is still re-issued on every response (`rolling: true`).
type TouchCallback = (err?: unknown) => void;
type TouchableStore = { touch?: (sid: string, session: any, callback?: TouchCallback) => void };

export function throttleTouch<S extends TouchableStore>(
  store: S,
  { intervalMs = 60_000, maxEntries = 5_000, now = Date.now }: { intervalMs?: number; maxEntries?: number; now?: () => number } = {},
): S {
  const original = store.touch?.bind(store);
  if (!original) return store;
  const last = new Map<string, number>();
  store.touch = (sid, session, callback) => {
    const t = now();
    const prev = last.get(sid);
    if (prev !== undefined && t - prev < intervalMs) {
      callback?.();
      return;
    }
    if (last.size >= maxEntries) last.clear(); // bounded; the worst case is one extra UPDATE each
    last.set(sid, t);
    original(sid, session, callback);
  };
  return store;
}
