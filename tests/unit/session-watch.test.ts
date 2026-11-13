import { describe, expect, it, vi } from "vitest";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { AUTH_QUERY_KEY, createSessionWatch, isUnauthorized } from "../../client/src/lib/queryClient";

function setup(me: unknown) {
  const qc = new QueryClient();
  if (me !== undefined) qc.setQueryData(AUTH_QUERY_KEY, me);
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  return { qc, invalidate, watch: createSessionWatch(() => qc) };
}

describe("expired session in an open tab", () => {
  it("recognises 401 errors by their status prefix only", () => {
    expect(isUnauthorized(new Error('401: {"message":"Authentication required"}'))).toBe(true);
    expect(isUnauthorized(new Error("401"))).toBe(true);
    expect(isUnauthorized(new Error("500: x 401"))).toBe(false);
    expect(isUnauthorized(new Error("4010: x"))).toBe(false);
    expect(isUnauthorized("401: x")).toBe(false);
  });

  it("a 401 from any poll re-checks /api/auth/me", () => {
    const { invalidate, watch } = setup({ authenticated: true });
    watch(new Error("401: Authentication required"), ["/api/system/info", "local"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: AUTH_QUERY_KEY });
  });

  it("a 401 from a mutation (no key) re-checks too", () => {
    const { invalidate, watch } = setup({ authenticated: true });
    watch(new Error("401: Authentication required"));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("other errors change nothing", () => {
    const { invalidate, watch } = setup({ authenticated: true });
    watch(new Error("500: boom"), ["/api/system/info", "local"]);
    watch(new Error('502: {"offline":true}'), ["/api/hosts/piapps2/system/info", "piapps2"]);
    watch(new TypeError("Failed to fetch"), ["/api/alerts?host=all"]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does nothing when already signed out (a wrong password on /login is a 401 too)", () => {
    const { invalidate, watch } = setup({ authenticated: false });
    watch(new Error("401: Invalid username or password."));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("never reacts to the auth check itself", () => {
    const { invalidate, watch } = setup({ authenticated: true });
    watch(new Error("401: x"), AUTH_QUERY_KEY);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("end to end: a failing poll flips the cached auth state to signed out", async () => {
    let signedIn = true;
    const holder: { qc?: QueryClient } = {};
    const watch = createSessionWatch(() => holder.qc!);
    const qc = (holder.qc = new QueryClient({
      queryCache: new QueryCache({ onError: (e, q) => watch(e, q.queryKey) }),
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    }));
    const me = vi.fn(async () => ({ authenticated: signedIn }));
    // An observer keeps the auth query active, as useAuth does in the app.
    const stop = qc.getQueryCache().build(qc, { queryKey: AUTH_QUERY_KEY, queryFn: me });
    await qc.fetchQuery({ queryKey: AUTH_QUERY_KEY, queryFn: me });
    expect(qc.getQueryData(AUTH_QUERY_KEY)).toEqual({ authenticated: true });

    signedIn = false; // the session expired on the server
    await qc.fetchQuery({ queryKey: ["/api/system/info", "local"], queryFn: async () => { throw new Error("401: Authentication required"); } }).catch(() => {});
    expect(qc.getQueryState(AUTH_QUERY_KEY)?.isInvalidated).toBe(true);
    await qc.fetchQuery({ queryKey: AUTH_QUERY_KEY, queryFn: me });
    expect(qc.getQueryData(AUTH_QUERY_KEY)).toEqual({ authenticated: false });
    void stop;
  });
});
