import { Link } from "wouter";
import {
  Activity,
  Boxes,
  Clock,
  Command,
  FileText,
  LogIn,
  Network,
  Server,
  ShieldCheck,
  Thermometer,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

// Public landing page for signed-out visitors on "/" (lazy chunk: signed-in users never load it).
// Same-origin only: no images, fonts or scripts from elsewhere; external sites are plain links.
// The dashboard preview is drawn with theme tokens and made-up demo values, so it follows
// light/dark and never shows a real host.

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__;

const REPO_URL = "https://github.com/hexawulf/PiDeck";

/** GitHub mark (lucide 1.x has no brand icons); currentColor, so it follows the theme. */
function GitHubMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: Activity,
    title: "Live dashboard",
    text: "CPU, memory, temperature, disks and network with 15m–24h history charts. Drag, resize and hide widgets; Comfortable or Compact density.",
  },
  {
    icon: Network,
    title: "Your whole fleet",
    text: "Small read-only agents on other machines (LAN or VPS, over WireGuard). One All hosts page, per-host history, offline and temperature alerts.",
  },
  {
    icon: Boxes,
    title: "Apps and services",
    text: "Docker containers and pm2 processes with start, stop and restart, plus the systemd services that actually run each host.",
  },
  {
    icon: FileText,
    title: "Logs that stay findable",
    text: "Project, pm2, nginx, journald and Docker logs. Plain or regex filters, pinned logs with their filters, deep links and downloads.",
  },
  {
    icon: Clock,
    title: "Cron, readable",
    text: "Every scheduled job with a human-readable schedule, its status, and a Run button for one-off runs.",
  },
  {
    icon: Command,
    title: "Keyboard-first",
    text: "Ctrl/⌘+K command palette, single-key shortcuts (press ?), bookmarkable tabs, and Live / Relaxed / Slow refresh or Pause.",
  },
] as const;

function DemoTile({ label, value, sub, pct }: { label: string; value: string; sub: string; pct?: number }) {
  return (
    <div className="rounded-md border border-pi-border bg-pi-card p-3">
      <div className="text-xs text-pi-text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold text-pi-text">{value}</div>
      {pct !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-pi-darker">
          <div className="h-1.5 rounded-full bg-pi-accent" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-1 text-[11px] text-pi-text-muted">{sub}</div>
    </div>
  );
}

function DemoHost({ name, detail, online = true }: { name: string; detail: string; online?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-2 text-sm text-pi-text">
        <span className={`h-2 w-2 rounded-full ${online ? "bg-pi-success" : "bg-pi-warning"}`} aria-hidden="true" />
        {name}
      </span>
      <span className="text-xs text-pi-text-muted">{detail}</span>
    </li>
  );
}

/** Decorative preview, drawn with tokens and demo data. */
function DashboardPreview() {
  return (
    <figure
      className="rounded-xl border border-pi-border bg-pi-darker p-3 shadow-2xl sm:p-4"
      aria-label="Example PiDeck dashboard with demo data"
      data-testid="landing-preview"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-pi-accent">
            <Server className="h-3.5 w-3.5 text-pi-on-accent" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-pi-text">pi-hub</span>
          <span className="flex items-center gap-1 text-xs text-pi-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-pi-success" aria-hidden="true" /> online
          </span>
        </div>
        <span className="rounded border border-pi-border px-1.5 py-0.5 font-mono text-[10px] text-pi-text-muted">Ctrl K</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <DemoTile label="CPU" value="18%" sub="4 cores · 1.8 GHz" pct={18} />
        <DemoTile label="Memory" value="34%" sub="2.7 / 8 GB" pct={34} />
        <DemoTile label="Temp" value="47°C" sub="Normal" />
      </div>
      <div className="mt-2 rounded-md border border-pi-border bg-pi-card p-3">
        <div className="flex items-center justify-between text-xs text-pi-text-muted">
          <span>Network · last hour</span>
          <span>↓ 1.2 MB/s · ↑ 240 KB/s</span>
        </div>
        <svg viewBox="0 0 300 60" preserveAspectRatio="none" className="mt-2 h-14 w-full text-pi-accent-text" role="presentation" aria-hidden="true">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            points="0,42 20,40 40,44 60,30 80,34 100,26 120,38 140,22 160,28 180,18 200,30 220,24 240,34 260,16 280,26 300,20"
          />
        </svg>
      </div>
      <div className="mt-2 rounded-md border border-pi-border bg-pi-card px-3 py-2">
        <div className="text-xs text-pi-text-muted">All hosts</div>
        <ul className="divide-y divide-pi-border">
          <DemoHost name="pi-hub" detail="18% CPU · 47°C" />
          <DemoHost name="pi-media" detail="6% CPU · 41°C" />
          <DemoHost name="vps-edge" detail="3% CPU · agent" />
          <DemoHost name="nas" detail="last seen 3 min ago" online={false} />
        </ul>
      </div>
      <figcaption className="sr-only">Demo data only</figcaption>
    </figure>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-pi-dark text-pi-text">
      <header className="border-b border-pi-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="PiDeck home">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pi-accent">
              <Server className="h-5 w-5 text-pi-on-accent" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold">PiDeck</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle className="rounded-md border" />
            <Link
              href="/login"
              className="rounded-md border border-pi-border px-3 py-2 text-sm font-semibold text-pi-text hover:bg-pi-card-hover"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-2">
          <div>
            <p className="mb-4 inline-block rounded-full bg-pi-success-soft px-3 py-1 text-xs font-semibold text-pi-text">
              Self-hosted · Raspberry Pi &amp; Linux · MIT
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">PiDeck</h1>
            <p className="mt-4 max-w-xl text-lg text-pi-text-muted">
              One fast admin dashboard for your Raspberry Pi and small Linux servers: live metrics, logs, Docker and pm2,
              cron, and every machine in your homelab in one place.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-md bg-pi-accent px-5 py-3 font-semibold text-pi-on-accent hover:bg-pi-accent-hover"
                data-testid="landing-signin"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in
              </Link>
              <a
                href={REPO_URL}
                className="inline-flex items-center gap-2 rounded-md border border-pi-border bg-pi-card px-5 py-3 font-semibold text-pi-text hover:bg-pi-card-hover"
                rel="noopener noreferrer"
              >
                <GitHubMark className="h-4 w-4" /> View on GitHub
              </a>
            </div>
          </div>
          <DashboardPreview />
        </section>

        <section className="border-t border-pi-border bg-pi-darker" aria-labelledby="features-heading">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 id="features-heading" className="text-2xl font-bold">
              What it does
            </h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-lg border border-pi-border bg-pi-card p-5">
                  <Icon className="h-5 w-5 text-pi-accent-text" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-pi-text-muted">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2" aria-labelledby="install-heading">
          <div>
            <h2 id="install-heading" className="text-2xl font-bold">
              Self-host it in a few minutes
            </h2>
            <p className="mt-3 text-pi-text-muted">
              One installer for the dashboard (the hub) and for read-only agents on your other machines. It shows
              everything it would change first, and asks before each choice.
            </p>
            <p className="mt-4 flex items-start gap-2 text-sm text-pi-text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-pi-accent-text" aria-hidden="true" />
              Session sign-in with optional Google sign-in, same-origin CSRF checks, a strict CSP, and agents that are
              read-only and reachable only by your hub.
            </p>
            <p className="mt-4 flex items-start gap-2 text-sm text-pi-text-muted">
              <Thermometer className="mt-0.5 h-4 w-4 flex-shrink-0 text-pi-accent-text" aria-hidden="true" />
              Built on a Raspberry Pi 5; also runs on x86 Linux and Synology DSM agents.
            </p>
            <a
              href={`${REPO_URL}/blob/main/docs/INSTALL.md`}
              className="mt-6 inline-block font-semibold text-pi-accent-text underline underline-offset-4"
              rel="noopener noreferrer"
            >
              Read the install guide
            </a>
          </div>
          <pre
            className="self-start overflow-x-auto rounded-lg bg-pi-terminal-bg p-5 font-mono text-sm leading-relaxed text-pi-terminal-text"
            aria-label="Install commands"
            tabIndex={0}
          >
            <code>
              <span className="text-pi-terminal-muted"># on the Pi that will run the dashboard</span>
              {"\n"}git clone {REPO_URL}.git
              {"\n"}cd PiDeck
              {"\n"}./scripts/install.sh --dry-run
              <span className="text-pi-terminal-muted">   # what it would do</span>
              {"\n"}./scripts/install.sh
              {"\n\n"}
              <span className="text-pi-terminal-muted"># on each other machine (same clone)</span>
              {"\n"}./scripts/install.sh --agent
            </code>
          </pre>
        </section>
      </main>

      <footer className="border-t border-pi-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-pi-text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            PiDeck v{APP_VERSION} · MIT License · Built by{" "}
            <a href="https://0xwulf.dev" className="underline underline-offset-4 hover:text-pi-text" rel="noopener noreferrer">
              0xWulf
            </a>
          </span>
          <span className="flex gap-4">
            <a href={REPO_URL} className="hover:text-pi-text" rel="noopener noreferrer">
              GitHub
            </a>
            <a href={`${REPO_URL}/releases`} className="hover:text-pi-text" rel="noopener noreferrer">
              Releases
            </a>
            <Link href="/login" className="hover:text-pi-text">
              Sign in
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
