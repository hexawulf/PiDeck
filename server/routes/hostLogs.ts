import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const r = Router();

// Allowlist (absolute paths only)
const LOGS: Record<string,string> = {
  'nginx_access': '/var/log/nginx/container.piapps.dev.access.log',
  'nginx_error':  '/var/log/nginx/container.piapps.dev.error.log',
  'pm2_pideck_out':  path.join(process.env.HOME || '/home/zk', '.pm2/logs/pideck-out.log'),
  'pm2_pideck_err':  path.join(process.env.HOME || '/home/zk', '.pm2/logs/pideck-error.log'),
  // project logs folder
  'pideck_cron': '/home/zk/logs/pideck-cron.log',
  'codepatchwork': '/home/zk/logs/codepatchwork.log',
  'synology': '/home/zk/logs/synology.log'
};

function tailFile(file: string, n = 500): string {
  // simple, safe tail without extra deps
  if (!fs.existsSync(file)) return '';
  const stat = fs.statSync(file);
  const size = Math.min(stat.size, 1024 * 1024); // cap to 1MB
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, stat.size - size);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  return lines.slice(-n).join('\n');
}

r.get('/:name', (req, res) => {
  const name = req.params.name;
  const file = LOGS[name];
  if (!file) return res.status(404).json({ error: 'unknown_log' });

  const tail = Math.min(Math.max(parseInt(String(req.query.tail || 500), 10) || 500, 1), 5000);
  let text = tailFile(file, tail);

  const grep = String(req.query.grep || '').trim();
  if (grep) {
    try {
      const rx = grep.startsWith('/') && grep.endsWith('/') ? new RegExp(grep.slice(1,-1), 'i') : new RegExp(grep, 'i');
      text = text.split('\n').filter(l => rx.test(l)).join('\n');
    } catch {
      const q = grep.toLowerCase();
      text = text.split('\n').filter(l => l.toLowerCase().includes(q)).join('\n');
    }
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(text);
});

export default r;