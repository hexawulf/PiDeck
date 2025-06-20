# PiDeck NGINX Configuration

This directory contains an example NGINX site configuration for `pideck.piapps.dev`.

## Enable the Site

Copy the file to `/etc/nginx/sites-available/` and create a symlink in `sites-enabled`:

```bash
sudo cp docs/nginx/pideck.piapps.dev.conf /etc/nginx/sites-available/pideck.piapps.dev
sudo ln -s /etc/nginx/sites-available/pideck.piapps.dev /etc/nginx/sites-enabled/
```

## Test and Reload NGINX

Always verify the configuration before reloading NGINX:

```bash
sudo nginx -t
sudo systemctl reload nginx
```
