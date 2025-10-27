
# PiDeck — Wire up IP / Ports / Firewall (Sonnet 4.5 TODO)

Target: **pideck.piapps.dev** (PiDeck @ `/home/zk/projects/PiDeck`, port **5006**)
Goal: The Dashboard tiles “IP Configuration”, “Listening Ports”, and “Firewall Status” must show live data instead of “Unavailable”.

---

## 0) Ground rules
- **Server:** Node/Express (TypeScript). Add read‑only endpoints under `/api/system/*`.
- **Client:** React (Vite). Fetch on load and on a 30s interval; show graceful empty/error states.
- **No sudo required.** Use commands that work for an unprivileged service account.
- **Security:** keep existing session auth/CSRF; rate‑limit these routes; never expose arbitrary shell exec.

---

## 1) Implement server endpoints

Create `server/src/routes/system.ts` and mount at `/api/system` (behind `requireAuth`).

### A) IP Configuration
**Endpoint:** `GET /api/system/ip`
- **Command:** `ip -j addr` (JSON output; available on Ubuntu >= 20.04).
- **Parse:** For each *UP* interface not `lo`, return `{ ifname, addr: [IPv4], ipv6: [IPv6], mac }`.
- **Fallbacks:** If `ip -j` missing, try `ip -o addr` and parse.
- **Shape:**
```json
{ "interfaces": [ { "ifname":"eth0","addr":["192.168.50.200"],"ipv6":["fd42::1234"],"mac":"b8:27:eb:..." } ] }
```

### B) Listening Ports
**Endpoint:** `GET /api/system/ports`
- **Command:** `ss -tuln` (no -p to avoid root requirement).
- **Parse:** Lines → protocol, local address, port, state `LISTEN`.
- **Add names (best effort):** resolve common services from a small allowlist (e.g., 22=ssh, 5006=pideck, 9090=prometheus, 3000=grafana). Do **not** DNS‑resolve.
- **Shape:**
```json
{ "listening": [ { "proto":"tcp","port":5006,"ip":"0.0.0.0","desc":"PiDeck" }, ... ] }
```

### C) Firewall Status
**Endpoint:** `GET /api/system/firewall`
- **Detect:** 
  1) `command -v ufw` ⇒ use `ufw status` (plain text). 
  2) else `command -v firewall-cmd` ⇒ `firewall-cmd --state` + `--list-ports`.
  3) else fallback to `nft list ruleset` presence ⇒ return `"nftables (no ufw) — assume managed by distro"`.
- **Normalize:** 
```json
{ "engine":"ufw","enabled":true,"rules":[{"action":"ALLOW","proto":"tcp","port":"22"}, ...] }
```
- If parsing fails, return `{ "engine":"unknown","enabled":false,"note":"no firewall tool detected" }` with HTTP 200.

### D) Code sketch (TypeScript)
Use a tiny exec helper:
```ts
import { execFile } from "node:child_process";
const run = (cmd: string, args: string[] = []) =>
  new Promise<{stdout:string, stderr:string}>((res, rej) =>
    execFile(cmd, args, { timeout: 4000 }, (e, stdout, stderr) => e ? rej(e) : res({stdout, stderr})));
```
- Validate with zod where needed.
- Rate‑limit: 10 req / 60s per IP across `/api/system/*`.

Mount in `server/src/index.ts`:
```ts
app.use("/api/system", requireAuth, systemRouter);
```

---

## 2) Wire the client tiles

File(s): `client/src/components/dashboard/*.tsx` (where the tiles render).

- **IP Configuration tile**
  - Fetch `/api/system/ip`
  - Render each interface: name, IPv4(s), IPv6 short form, MAC. 
  - Empty → “No active interfaces” (subtle gray).

- **Listening Ports tile**
  - Fetch `/api/system/ports`
  - Show top 10 by port ascending (chip list: proto/port/desc). 
  - Add “View all” link → modal with full list.

- **Firewall Status tile**
  - Fetch `/api/system/firewall`
  - If `enabled=true` → green badge with engine; else red “Disabled / Unknown”.
  - Show up to 8 normalized rules (`ALLOW tcp 22`, etc.).

All tiles: re‑fetch every **30s**; also on window focus. Show spinner → error → data states.

---

## 3) Tests & verification

### Curl sanity (local on Pi)
```bash
curl -sS http://127.0.0.1:5006/api/system/ip       | jq .interfaces[0]
curl -sS http://127.0.0.1:5006/api/system/ports    | jq '.listening | length'
curl -sS http://127.0.0.1:5006/api/system/firewall | jq .
```

### Browser checks
1. Login to `https://pideck.piapps.dev`.
2. Confirm the three tiles populate within 1–2s.
3. Toggle focus or wait 30s to see periodic refresh.

---

## 4) Edge cases & notes
- Containers bound to loopback (e.g., 127.0.0.1:3000) should still appear in **Listening Ports** (show `ip="127.0.0.1"`).
- If `ip` returns many virtual interfaces, filter to `state=UP` and non‑docker unless `?includeDocker=1` is passed.
- If `ufw` is installed but inactive, return `enabled=false` and include `rules: []`.
- Keep responses small (<50KB). Truncate long lists (e.g., ports > 200) unless `?full=1`.

---

## 5) Deploy
```bash
# from /home/zk/projects/PiDeck
npm run build && pm2 restart pideck --update-env
# or if using ecosystem config name differs, adjust accordingly
```

---

## 6) Acceptance criteria
- All 3 tiles no longer show “Unavailable” after login.
- Endpoints respond < 400ms on the Pi (warm).
- No elevated privileges required; all routes enforce session auth and rate limits.
- Errors are visible as friendly inline messages, not blank tiles.
