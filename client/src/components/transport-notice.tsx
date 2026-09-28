import { ShieldAlert } from "lucide-react";

export type Transport = { secureCookie: boolean; insecureHttp: boolean };

/**
 * What to tell the user about the connection, if anything:
 *   blocked  — the server sends a Secure cookie but the page is plain HTTP:
 *              the browser will drop it and login can't stick.
 *   insecure — PIDECK_INSECURE_HTTP=1 and the page is plain HTTP: login works,
 *              but the session cookie travels unencrypted.
 */
export function transportWarning(t: Transport | undefined, protocol: string): "blocked" | "insecure" | null {
  if (!t || protocol !== "http:") return null;
  if (t.secureCookie) return "blocked";
  if (t.insecureHttp) return "insecure";
  return null;
}

export function TransportNotice({ transport }: { transport?: Transport }) {
  const kind = transportWarning(transport, typeof window === "undefined" ? "https:" : window.location.protocol);
  if (!kind) return null;
  return (
    <div role="alert" className="mb-6 flex gap-2 rounded-md border border-pi-warning p-3 text-sm text-pi-text" data-testid="transport-notice">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-pi-warning" aria-hidden />
      {kind === "blocked" ? (
        <p>
          This server only accepts logins over <strong>HTTPS</strong> (its session cookie is marked Secure), so a login
          on plain http:// won't stick. Open PiDeck through your TLS proxy, or see docs/INSTALL.md → “LAN HTTP”.
        </p>
      ) : (
        <p>
          <strong>Plain HTTP mode.</strong> Your password and session cookie are sent unencrypted. Use this only on a
          network you trust, or put PiDeck behind HTTPS (docs/INSTALL.md).
        </p>
      )}
    </div>
  );
}
