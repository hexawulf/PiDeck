// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENDPOINT_SCHEMAS } from "@/widgets/schemas";
import { describeError, UnexpectedDataError, useWidgetQuery } from "@/widgets/useWidgetQuery";
import { QueryState } from "@/widgets/WidgetFrame";
import { FIXTURES } from "./widget-fixtures";

afterEach(cleanup);

describe("endpoint schemas", () => {
  it("cover every fixture", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(ENDPOINT_SCHEMAS).sort());
  });
  for (const [url, schema] of Object.entries(ENDPOINT_SCHEMAS)) {
    it(`${url} accepts a realistic response`, () => {
      const r = schema.safeParse(FIXTURES[url]);
      expect(r.success, JSON.stringify(!r.success && r.error.issues)).toBe(true);
    });
  }
  it("reject a malformed response", () => {
    expect(ENDPOINT_SCHEMAS["/api/metrics/ram"].safeParse({ total: "8GB" }).success).toBe(false);
    expect(ENDPOINT_SCHEMAS["/api/metrics/mounts"].safeParse({ mounts: [] }).success).toBe(false);
  });
});

function Probe({ url }: { url: keyof typeof ENDPOINT_SCHEMAS }) {
  const q = useWidgetQuery(url, false, ENDPOINT_SCHEMAS[url]);
  return <QueryState query={q}>{() => <p>ok</p>}</QueryState>;
}

function renderWith(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe url="/api/metrics/ram" />
    </QueryClientProvider>,
  );
}

describe("useWidgetQuery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders data that matches the schema", async () => {
    renderWith(FIXTURES["/api/metrics/ram"]);
    await waitFor(() => expect(screen.getByText("ok")).toBeTruthy());
  });

  it("shows 'Unexpected data' when the shape is wrong", async () => {
    renderWith({ total: "lots" });
    await waitFor(() => expect(screen.getByText("Unexpected data from the server")).toBeTruthy());
    expect(screen.getByText(/\/api\/metrics\/ram: total/)).toBeTruthy();
  });

  it("shows a friendly line and the raw status/body for HTTP errors", async () => {
    renderWith('{"error":"SMART data unavailable"}', 500);
    await waitFor(() => expect(screen.getByText("The server couldn't read this metric")).toBeTruthy());
    expect(screen.getByText('500: {"error":"SMART data unavailable"}')).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});

describe("describeError", () => {
  it.each([
    [new Error("401: nope"), "Session expired — sign in again"],
    [new Error("404: Cannot GET"), "Not available on this host"],
    [new TypeError("Failed to fetch"), "Server unreachable"],
    [new UnexpectedDataError("/x", []), "Unexpected data from the server"],
    [new Error("weird"), "Couldn't load data"],
  ])("%s → %s", (err, summary) => {
    expect(describeError(err).summary).toBe(summary);
  });
});
