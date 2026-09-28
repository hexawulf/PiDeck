# PiDeck Deployment

Deployment is covered by the install guide: **[docs/INSTALL.md](./INSTALL.md)**.

- One command: `./scripts/install.sh --dry-run`, then `./scripts/install.sh`
- HTTPS with nginx (`deploy/nginx/pideck.conf.example`) or Caddy, or plain LAN HTTP (`--lan-http`)
- pm2 or systemd (`deploy/systemd/pideck.service.template`)
- Updates, rollback and uninstall: `./scripts/install.sh --update`, `./scripts/uninstall.sh`

The site config for the public demo host lives in [docs/nginx/](./nginx/).
