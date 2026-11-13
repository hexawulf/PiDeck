import { describe, expect, it, vi } from "vitest";
import { throttleTouch } from "../../server/session-touch";

function setup(opts: { intervalMs?: number; maxEntries?: number } = {}) {
  let t = 1_000_000;
  const touch = vi.fn((_sid: string, _s: unknown, cb?: (e?: unknown) => void) => cb?.());
  const store = throttleTouch({ touch }, { ...opts, now: () => t });
  return { store, touch, advance: (ms: number) => (t += ms) };
}

describe("session touch throttle", () => {
  it("writes the first touch, skips the next ones for a minute, then writes again", () => {
    const { store, touch, advance } = setup();
    const cb = vi.fn();
    store.touch!("a", {}, cb);
    for (let i = 0; i < 20; i++) {
      advance(2_000);
      store.touch!("a", {}, cb);
    }
    expect(touch).toHaveBeenCalledTimes(1);
    advance(21_000); // 61 s after the first
    store.touch!("a", {}, cb);
    expect(touch).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledTimes(22); // the caller always hears back
  });

  it("throttles each session on its own", () => {
    const { store, touch } = setup();
    store.touch!("a", {});
    store.touch!("b", {});
    store.touch!("a", {});
    expect(touch.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });

  it("stays bounded: past the cap it forgets and writes again", () => {
    const { store, touch } = setup({ maxEntries: 2 });
    store.touch!("a", {});
    store.touch!("b", {});
    store.touch!("c", {}); // clears, then remembers c
    store.touch!("a", {});
    expect(touch).toHaveBeenCalledTimes(4);
  });

  it("passes the store's error to the caller", () => {
    let t = 0;
    const store = throttleTouch({ touch: (_s: string, _x: unknown, cb?: (e?: unknown) => void) => cb?.(new Error("db down")) }, { now: () => t });
    const cb = vi.fn();
    store.touch!("a", {}, cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("leaves a store without touch alone", () => {
    const store = {};
    expect(throttleTouch(store)).toBe(store);
  });
});
