import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PIDECK_LOGS_DIR, PM2_LOGS_DIR } from '../config';

const execFileAsync = promisify(execFile);
const r = Router();
const LARGE_LOG_BYTES = 50 * 1024 * 1024;
const READ_WINDOW_BYTES = 1024 * 1024;
const MAX_TAIL_LINES = 5000;
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

const ALLOWLIST_LOGS: Record<string, { name: string; label: string; path: string; source: 'nginx' | 'pm2' | 'project' }> = {
  'nginx_access': { name: 'access.log', label: 'Nginx Access Log', path: '/var/log/nginx/access.log', source: 'nginx' },
  'nginx_error': { name: 'error.log', label: 'Nginx Error Log', path: '/var/log/nginx/error.log', source: 'nginx' },
  'pm2_pideck_out': { name: 'pideck-out.log', label: 'PM2 PiDeck Output', path: path.join(PM2_LOGS_DIR, 'pideck-out.log'), source: 'pm2' },
  'pm2_pideck_err': { name: 'pideck-error.log', label: 'PM2 PiDeck Error', path: path.join(PM2_LOGS_DIR, 'pideck-error.log'), source: 'pm2' },
  'pitasker_out': { name: 'out.log', label: 'PiTasker Output', path: '/var/log/pitasker/out.log', source: 'pm2' },
  'pitasker_err': { name: 'error.log', label: 'PiTasker Error', path: '/var/log/pitasker/error.log', source: 'pm2' },
  'pitasker_combined': { name: 'combined.log', label: 'PiTasker Combined', path: '/var/log/pitasker/combined.log', source: 'pm2' },
  'pideck_cron': { name: 'pideck-cron.log', label: 'PiDeck Cron', path: path.join(PIDECK_LOGS_DIR, 'pideck-cron.log'), source: 'project' },
  'codepatchwork': { name: 'codepatchwork.log', label: 'CodePatchwork', path: path.join(PIDECK_LOGS_DIR, 'codepatchwork.log'), source: 'project' },
  'synology': { name: 'synology.log', label: 'Synology', path: path.join(PIDECK_LOGS_DIR, 'synology.log'), source: 'project' }
};

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
  
  // Add allowlisted logs (these take priority in de-duplication)
  for (const [id, log] of Object.entries(ALLOWLIST_LOGS)) {
    const validated = await validateReadableFile(log.path);
    if (validated) {
      logs.push({
        id,
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

// Get log file by ID
async function getLogById(id: string): Promise<LogItem | null> {
  const logs = await getAllLogs();
  return logs.find(log => log.id === id) || null;
}

// Simple tail function for small files
function tailFile(file: string, n = 500): string {
  if (!fs.existsSync(file)) return '';
  const stat = fs.statSync(file);
  const size = Math.min(stat.size, READ_WINDOW_BYTES); // cap to 1MB
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, stat.size - size);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  return lines.slice(-n).join('\n');
}

// Tail using system command for large files
async function tailFileLarge(file: string, n = 1000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('tail', ['-n', String(n), file], {
      maxBuffer: READ_WINDOW_BYTES * 2,
    });
    return stdout;
  } catch {
    return '';
  }
}

// GET /api/hostlogs - List all available logs
r.get('/', async (req, res) => {
  try {
    const logs = await getAllLogs();
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
    
    const tail = Math.min(Math.max(parseInt(String(req.query.tail || 1000), 10) || 1000, 1), MAX_TAIL_LINES);
    
    // Use system tail for large files
    let text = log.large ? await tailFileLarge(validated.path, tail) : tailFile(validated.path, tail);
    
    const grep = String(req.query.grep || '').trim();
    if (grep) {
      if (grep.length > 200) {
        return res.status(400).json({ message: 'grep pattern too long (max 200 chars)' });
      }
      try {
        const pattern = grep.startsWith('/') && grep.endsWith('/') ? grep.slice(1,-1) : grep;
        const rx = new RegExp(pattern, 'i');
        text = text.split('\n').filter(l => rx.test(l)).join('\n');
      } catch {
        const q = grep.toLowerCase();
        text = text.split('\n').filter(l => l.toLowerCase().includes(q)).join('\n');
      }
    }
    
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

// GET /api/hostlogs/:id/follow - SSE live tail (placeholder for now)
r.get('/:id/follow', async (_req, res) => {
  try {
    const id = _req.params.id;
    const log = await getLogById(id);
    
    if (!log) {
      return res.status(404).json({ message: 'Log not found' });
    }
    
    // For now, return a simple message since SSE implementation is complex
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('Live tail functionality will be implemented in a future update');
  } catch (error) {
    console.error('Error setting up live tail:', error);
    res.status(500).json({ message: 'Failed to set up live tail' });
  }
});

export default r;
