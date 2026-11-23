// @vitest-environment jsdom
// Public landing page on "/": signed out → landing, signed in → /dashboard; deep links still → /login.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const auth = vi.hoisted(() => ({ state: { isAuthenticated: false, isLoading: false } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ ...auth.state, user: undefined }) }));
// The protected shell and the login page aren't under test here; keep them trivial.
vi.mock("@/components/app-shell", () => ({ default: () => <div data-testid="shell" />, isTabId: (t: string) => t === "dashboard" || t === "logs" }));
vi.mock("@/pages/login", () => ({ default: () => <div data-testid="login-page" /> }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => <button type="button">theme</button> }));

import { AppRoutes } from "@/App";

function renderAt(path: string) {
  const loc = memoryLocation({ path, record: true });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={loc.hook}>
        <AppRoutes />
      </Router>
    </QueryClientProvider>,
  );
  return loc;
}

afterEach(() => {
  cleanup();
  auth.state = { isAuthenticated: false, isLoading: false };
});

describe("landing page on /", () => {
  it("shows the landing page to signed-out visitors", async () => {
    const loc = renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "PiDeck" })).toBeTruthy();
    expect(loc.history.at(-1)).toBe("/");
    const signIn = screen.getByTestId("landing-signin");
    expect(signIn.getAttribute("href")).toBe("/login");
    expect(screen.getByTestId("landing-preview")).toBeTruthy();
  });

  it("has one h1, labelled sections and no external images or scripts", async () => {
    renderAt("/");
    await screen.findByRole("heading", { level: 1, name: "PiDeck" });
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "What it does" })).toBeTruthy();
    expect(document.querySelectorAll("img, script, iframe")).toHaveLength(0);
    for (const a of Array.from(document.querySelectorAll("a[href^='http']"))) {
      expect(a.getAttribute("rel")).toContain("noopener");
    }
  });

  it("sends signed-in users to /dashboard", () => {
    auth.state = { isAuthenticated: true, isLoading: false };
    const loc = renderAt("/");
    expect(loc.history.at(-1)).toBe("/dashboard");
    expect(screen.queryByTestId("landing-preview")).toBeNull();
  });

  it("waits for the session check before deciding", () => {
    auth.state = { isAuthenticated: false, isLoading: true };
    renderAt("/");
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByTestId("landing-preview")).toBeNull();
  });

  it("still sends a signed-out deep link to /login", () => {
    const loc = renderAt("/logs");
    expect(loc.history.at(-1)).toBe("/login");
  });
});
