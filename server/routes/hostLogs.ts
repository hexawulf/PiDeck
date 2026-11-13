import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { PIDECK_LOGS_DIR, hostLogs } from '../config';
import { lineFilter, LogFilterError } from '../services/log-filter';
import { tailFile } from '../services/agent-logs/sources';
import { redactLine } from '../services/agent-logs/redact';

const r = Router();
const LARGE_LOG_BYTES = 50 * 1024 * 1024;
const MAX_TAIL_LINES = 5000;
// The list scans ~/logs (160+ files on piapps), nginx and the configured
// logs; reads and list refreshes within this window share one scan (PD-16).
const LIST_CACHE_MS = 5_000;
const NGINX_LOG_DIR = '/var/log/nginx';

interface LogItem {
  id: string;
  name: string;
  label: string;
  path: string;
  size: number;
  mtime: string;
  source: 'home' | 'nginx' | 'pm2' | 'project';
  large?: boolean;
}

interface ValidatedLogFile {
  path: string;
  stat: fs.Stats;
}

function labelFromFilename(filename: string): string {
  return filename
    .replace(/\.log(\.\d+)?(\.gz)?$/, '')
    .replace(/\.gz$/, '')
    .replace(/\.\d{4}-\d{2}-\d{2}(\.0)?$/, '')
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function isRotatedTextLog(filename: string): boolean {
  return filename.endsWith('.log') || /\.log\.\d+$/.test(filename);
}

function isWithinDir(filePath: string, baseDir: string): boolean {
  const relative = path.relative(baseDir, filePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Fixed log files: generic defaults + PIDECK_HOST_LOGS (see server/config.ts).
// Missing or unreadable files are simply not listed.
const HOST_LOGS = hostLogs();

async function validateReadableFile(filePath: string, allowedBaseDir?: string): Promise<ValidatedLogFile | null> {
  try {
    const lstat = await fs.promises.lstat(filePath);
    if (!lstat.isFile() || lstat.isSymbolicLink()) {
      return null;
    }

    const resolvedPath = await fs.promises.realpath(filePath);
    if (resolvedPath !== filePath) {
      return null;
    }

    if (allowedBaseDir && !isWithinDir(resolvedPath, allowedBaseDir)) {
      return null;
    }

    await fs.promises.access(resolvedPath, fs.constants.R_OK);
    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isFile()) {
      return null;
    }

    return { path: resolvedPath, stat };
  } catch {
    return null;
  }
}

// Get rotated log files for nginx
async function getNginxRotatedLogs(): Promise<LogItem[]> {
  const logs: LogItem[] = [];
  
  try {
    const files = await fs.promises.readdir(NGINX_LOG_DIR);
    const nginxPatterns = [
      /^access\.log(?:\.\d+)?$/,
      /^error\.log(?:\.\d+)?$/
    ];
    
    for (const file of files) {
      if (nginxPatterns.some(pattern => pattern.test(file))) {
        const filePath = path.join(NGINX_LOG_DIR, file);
        const validated = await validateReadableFile(filePath, NGINX_LOG_DIR);
        if (validated) {
          const id = `nginx_${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
          logs.push({
            id,
            name: file,
            label: `Nginx ${labelFromFilename(file)}`,
            path: validated.path,
            size: validated.stat.size,
            mtime: validated.stat.mtime.toISOString(),
            source: 'nginx',
            large: validated.stat.size > LARGE_LOG_BYTES
          });
        }
      }
    }
  } catch {
    // Skip if directory doesn't exist or can't be read
  }
  
  return logs;
}

async function scanHomeLogs(): Promise<LogItem[]> {
  const logs: LogItem[] = [];
  const logDir = PIDECK_LOGS_DIR;
  
  try {
    const files = await fs.promises.readdir(logDir);
    
    for (const file of files) {
      if (file.startsWith('.')) continue;
      if (file.endsWith('.lock') || file.endsWith('.bak')) continue;
      if (!isRotatedTextLog(file)) continue;
      
      const filePath = path.join(logDir, file);
      const validated = await validateReadableFile(filePath, logDir);

      if (validated) {
        logs.push({
          id: `home_${file.replace(/[^a-zA-Z0-9]/g, '_')}`,
          name: file,
          label: labelFromFilename(file),
          path: validated.path,
          size: validated.stat.size,
          mtime: validated.stat.mtime.toISOString(),
          source: 'home',
          large: validated.stat.size > LARGE_LOG_BYTES
        });
      }
    }
  } catch {
    // Skip if directory doesn't exist or can't be read
  }
  
  return logs;
}

// Get all log files
async function getAllLogs(): Promise<LogItem[]> {
  const logs: LogItem[] = [];
  
  // Add configured logs (these take priority in de-duplication)
  for (const log of HOST_LOGS) {
    const validated = await validateReadableFile(log.path);
    if (validated) {
      logs.push({
        id: log.id,
        name: log.name,
        label: log.label,
        path: validated.path,
        size: validated.stat.size,
        mtime: validated.stat.mtime.toISOString(),
        source: log.source,
        large: validated.stat.size > LARGE_LOG_BYTES
      });
    }
  }

  // Add nginx rotated logs
  const nginxLogs = await getNginxRotatedLogs();
  logs.push(...nginxLogs);
  
  // Add home logs
  const homeLogs = await scanHomeLogs();
  logs.push(...homeLogs);
  
  // De-duplicate by path (first entry wins → allowlist takes priority)
  const seen = new Map<string, LogItem>();
  for (const log of logs) {
    if (!seen.has(log.path)) seen.set(log.path, log);
  }
  const uniqueLogs = Array.from(seen.values());
  return uniqueLogs.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
}

let listCache: { at: number; logs: Promise<LogItem[]> } | null = null;

/** getAllLogs(), shared for LIST_CACHE_MS (an in-flight scan is shared too). */
function cachedLogs(fresh = false): Promise<LogItem[]> {
  const now = Date.now();
  if (fresh || !listCache || now - listCache.at > LIST_CACHE_MS) {
    const logs = getAllLogs();
    const entry = { at: now, logs };
    listCache = entry;
    logs.catch(() => { if (listCache === entry) listCache = null; });
  }
  return listCache!.logs;
}

/** Test hook: forget the cached list. */
export function resetLogListCache(): void {
  listCache = null;
}

// Get log file by ID. An id missing from the cached list gets one fresh scan
// before it is called unknown (a log created in the last few seconds).
async function getLogById(id: string): Promise<LogItem | null> {
  const hit = (await cachedLogs()).find(log => log.id === id);
  if (hit) return hit;
  return (await cachedLogs(true)).find(log => log.id === id) || null;
}

// GET /api/hostlogs - List all available logs
r.get('/', async (req, res) => {
  try {
    const logs = await cachedLogs();
    res.json(logs);
  } catch (error) {
    console.error('Error getting log list:', error);
    res.status(500).json({ message: 'Failed to get log list' });
  }
});

// GET /api/hostlogs/:id - Get log content
r.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const log = await getLogById(id);
    
    if (!log) {
      return res.status(404).json({ message: 'Log not found' });
    }
    
    const validated = await validateReadableFile(log.path);
    if (!validated) {
      return res.status(404).json({ message: 'Log file is no longer available' });
    }
    
    // Validate the filter before reading anything: substring by default,
    // /regex/ only when short and free of nested quantifiers (runs on the event loop).
    let keep: ((line: string) => boolean) | null;
    try {
      keep = lineFilter(req.query.grep);
    } catch (err) {
      if (err instanceof LogFilterError) return res.status(err.status).json({ message: err.message });
      throw err;
    }

    const tail = Math.min(Math.max(parseInt(String(req.query.tail || 1000), 10) || 1000, 1), MAX_TAIL_LINES);

    // The same reader and redaction as the agents (PD-16): whole lines from the
    // end of the file, secrets replaced before the filter sees them (a filter
    // must never match a secret's value), and say when older lines were cut.
    const { lines, truncated } = await tailFile(validated.path, tail);
    let redacted = 0;
    const out: string[] = [];
    for (const line of lines) {
      const r = redactLine(line);
      if (keep && !keep(r.text)) continue;
      redacted += r.count;
      out.push(r.text);
    }
    const text = out.join('\n');
    res.setHeader('X-PiDeck-Truncated', truncated ? '1' : '0');
    res.setHeader('X-PiDeck-Redacted', String(redacted));

    if (req.query.download === '1') {
      const safeName = log.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.log"`);
    }
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (error) {
    console.error('Error getting log content:', error);
    res.status(500).json({ message: 'Failed to get log content' });
  }
});

export default r;
