import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const r = Router();

interface LogItem {
  id: string;
  name: string;
  path: string;
  size: number;
  mtime: string;
  source: 'home' | 'nginx' | 'pm2' | 'project';
  large?: boolean;
}

// Allowlist (absolute paths only)
const ALLOWLIST_LOGS: Record<string, { name: string; path: string; source: 'nginx' | 'pm2' | 'project' }> = {
  'nginx_access': { name: 'Nginx Access Log', path: '/var/log/nginx/access.log', source: 'nginx' },
  'nginx_error': { name: 'Nginx Error Log', path: '/var/log/nginx/error.log', source: 'nginx' },
  'pm2_pideck_out': { name: 'PM2 PiDeck Output', path: path.join(process.env.HOME || '/home/zk', '.pm2/logs/pideck-out.log'), source: 'pm2' },
  'pm2_pideck_err': { name: 'PM2 PiDeck Error', path: path.join(process.env.HOME || '/home/zk', '.pm2/logs/pideck-error.log'), source: 'pm2' },
  'pideck_cron': { name: 'PiDeck Cron', path: '/home/zk/logs/pideck-cron.log', source: 'project' },
  'codepatchwork': { name: 'CodePatchwork', path: '/home/zk/logs/codepatchwork.log', source: 'project' },
  'synology': { name: 'Synology', path: '/home/zk/logs/synology.log', source: 'project' }
};

// Get rotated log files for nginx
async function getNginxRotatedLogs(): Promise<LogItem[]> {
  const logs: LogItem[] = [];
  const baseDir = '/var/log/nginx';
  
  try {
    const files = await fs.promises.readdir(baseDir);
    const nginxPatterns = [
      /^access\.log(\.\d+|\.[\w\d]+)?$/,
      /^error\.log(\.\d+|\.[\w\d]+)?$/
    ];
    
    for (const file of files) {
      if (nginxPatterns.some(pattern => pattern.test(file))) {
        const filePath = path.join(baseDir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          const id = `nginx_${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
          logs.push({
            id,
            name: `Nginx ${file}`,
            path: filePath,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
            source: 'nginx',
            large: stat.size > 50 * 1024 * 1024
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Skip if directory doesn't exist or can't be read
  }
  
  return logs;
}

// Scan /home/zk/logs directory
async function scanHomeLogs(): Promise<LogItem[]> {
  const logs: LogItem[] = [];
  const logDir = '/home/zk/logs';
  
  try {
    const files = await fs.promises.readdir(logDir);
    
    for (const file of files) {
      // Skip hidden files
      if (file.startsWith('.')) continue;
      
      const filePath = path.join(logDir, file);
      
      try {
        const stat = await fs.promises.stat(filePath);
        
        // Skip directories
        if (stat.isDirectory()) continue;
        
        // Include: *.log, *.log.*, *.gz, files without ext but size > 0
        const shouldInclude = 
          file.endsWith('.log') ||
          /^\.log\./.test(file) ||
          file.endsWith('.gz') ||
          (!file.includes('.') && stat.size > 0);
        
        if (shouldInclude) {
          logs.push({
            id: `home_${file.replace(/[^a-zA-Z0-9]/g, '_')}`,
            name: file,
            path: filePath,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
            source: 'home',
            large: stat.size > 50 * 1024 * 1024
          });
        }
      } catch {
        // Skip files we can't stat
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
  
  // Add allowlisted logs
  for (const [id, log] of Object.entries(ALLOWLIST_LOGS)) {
    try {
      const stat = await fs.promises.stat(log.path);
      logs.push({
        id,
        name: log.name,
        path: log.path,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        source: log.source,
        large: stat.size > 50 * 1024 * 1024
      });
    } catch {
      // Skip files that don't exist or can't be read
    }
  }
  
  // Add nginx rotated logs
  const nginxLogs = await getNginxRotatedLogs();
  logs.push(...nginxLogs);
  
  // Add home logs
  const homeLogs = await scanHomeLogs();
  logs.push(...homeLogs);
  
  // De-duplicate by path and sort by mtime desc
  const uniqueLogs = Array.from(new Map(logs.map(log => [log.path, log])).values());
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
  const size = Math.min(stat.size, 1024 * 1024); // cap to 1MB
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
    const { stdout } = await execAsync(`tail -n ${n} "${file}"`);
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
    
    // Check if file exists and is readable
    try {
      await fs.promises.access(log.path, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ message: 'Log file not accessible' });
    }
    
    const tail = Math.min(Math.max(parseInt(String(req.query.tail || 1000), 10) || 1000, 1), 5000);
    
    // Use system tail for large files
    let text = log.large ? await tailFileLarge(log.path, tail) : tailFile(log.path, tail);
    
    // Apply grep filter if provided
    const grep = String(req.query.grep || '').trim();
    if (grep) {
      try {
        const rx = grep.startsWith('/') && grep.endsWith('/') ? 
          new RegExp(grep.slice(1,-1), 'i') : new RegExp(grep, 'i');
        text = text.split('\n').filter(l => rx.test(l)).join('\n');
      } catch {
        const q = grep.toLowerCase();
        text = text.split('\n').filter(l => l.toLowerCase().includes(q)).join('\n');
      }
    }
    
    // Handle download request
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${log.name}.log"`);
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