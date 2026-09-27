// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetFrame } from "@/widgets/WidgetFrame";

afterEach(cleanup);

let shouldThrow = true;
let mounts = 0;
function Flaky() {
  mounts++;
  if (shouldThrow) throw new TypeError("boom");
  return <p>recovered</p>;
}

describe("WidgetFrame error boundary", () => {
  it("contains a throwing body to its own card and retries by remounting", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // React dev mode re-dispatches caught render errors; keep jsdom quiet.
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", quiet);
    shouldThrow = true;
    mounts = 0;
    render(
      <>
        <WidgetFrame id="bad" title="Bad">
          <Flaky />
        </WidgetFrame>
        <WidgetFrame id="good" title="Good">
          <p>sibling ok</p>
        </WidgetFrame>
      </>,
    );

    expect(screen.getByText("Widget failed")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy(); // raw message in the details disclosure
    expect(screen.getByText("sibling ok")).toBeTruthy();
    expect(log.mock.calls.some((c) => c[0] === "[widget:bad]")).toBe(true);

    shouldThrow = false;
    const before = mounts;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(screen.getByText("recovered")).toBeTruthy();
    expect(mounts).toBeGreaterThan(before);
    window.removeEventListener("error", quiet);
  });

  it("labels the region with its title", () => {
    render(
      <WidgetFrame id="cpu" title="CPU Usage">
        <p>x</p>
      </WidgetFrame>,
    );
    expect(screen.getByRole("region", { name: "CPU Usage" })).toBeTruthy();
  });
});
