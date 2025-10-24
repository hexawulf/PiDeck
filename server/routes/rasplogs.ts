import { Router } from "express";
import { readdir, stat, realpath } from "fs/promises";
import { resolve, basename } from "path";
import { spawn } from "child_process";
import type { LogIndexEntry } from "@shared/schema";

const rasplogsRouter = Router();


const LOGS_DIR = "/home/zk/logs";
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MiB

const ALLOWED_EXTENSIONS = [".log", ".txt", ".journal"];
const IGNORED_PATTERNS = [/\.gz$/, /\.tar\.gz$/, /\.zip$/];

// Function to safely check real paths
async function isPathSafe(filePath: string): Promise<boolean> {
  try {
    const resolved = await realpath(filePath);
    return resolved.startsWith(LOGS_DIR);
  } catch (err) {
    return false; // File does not exist or other error
  }
}

// GET /api/rasplogs -> list log files
rasplogsRouter.get("/rasplogs", async (_req, res) => {
  try {
    const dirents = await readdir(LOGS_DIR, { withFileTypes: true });
    const logEntries: LogIndexEntry[] = [];

    for (const dirent of dirents) {
      if (dirent.isDirectory()) continue;

      const fileName = dirent.name;
      const fileExt = basename(fileName);

      if (
        !ALLOWED_EXTENSIONS.some((ext) => fileName.endsWith(ext)) ||
        IGNORED_PATTERNS.some((pattern) => pattern.test(fileName))
      ) {
        continue;
      }

      const filePath = resolve(LOGS_DIR, fileName);
      if (!(await isPathSafe(filePath))) continue;

      const stats = await stat(filePath);
      logEntries.push({
        id: fileName,
        name: fileName,
        label: fileName,
        path: filePath,
        size: stats.size,
        mtime: stats.mtime.toISOString(),
        pathExists: true,
        tooLarge: stats.size > MAX_FILE_SIZE_BYTES,
      });
    }

    // Sort by modification time, newest first
    logEntries.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

    res.json(logEntries);
  } catch (error) {
    console.error("Error listing rasplogs:", error);
    res.status(500).json({ message: "Failed to list log files." });
  }
});

// GET /api/rasplogs/:name -> tail/stream a log file
rasplogsRouter.get("/rasplogs/:name", async (req, res) => {
  const { name } = req.params;
  const { tail = "1000", grep, follow } = req.query;

  const filePath = resolve(LOGS_DIR, name);

  if (!(await isPathSafe(filePath))) {
    return res.status(403).json({ message: "Forbidden: Access outside of log directory is not allowed." });
  }

  try {
    await stat(filePath);
  } catch (err) {
    return res.status(404).json({ message: "Log file not found." });
  }

  if (follow === "1") {
    // SSE streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Note: For Nginx proxy, recommended timeout settings:
    // proxy_read_timeout 300s; proxy_send_timeout 300s;

    // SSE heartbeat - emit keepalive every ~25s
    const HEARTBEAT_MS = 25000;
    const hb = setInterval(() => {
      try { res.write(':keepalive\n\n'); } catch { /* ignore */ }
    }, HEARTBEAT_MS);

    const tailCommand = ["-n", tail as string, "-F", filePath];
    const tailProc = spawn("tail", tailCommand);

    let stream: NodeJS.ReadableStream = tailProc.stdout;

    if (grep) {
      const grepProc = spawn("grep", [grep as string]);
      tailProc.stdout.pipe(grepProc.stdin);
      stream = grepProc.stdout;
    }

    const onData = (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        res.write(`data: ${JSON.stringify({ line })}\n\n`);
      }
    };

    stream.on("data", onData);

    req.on("close", () => {
      clearInterval(hb);
      stream.removeListener("data", onData);
      tailProc.kill();
    });
  } else {
    // Snapshot
    const args = ["-n", tail as string];
    let child;

    if (grep) {
      const grepProc = spawn("grep", [grep as string, filePath]);
      child = spawn("tail", args, { stdio: [grepProc.stdout, "pipe", "pipe"] });
    } else {
      args.push(filePath);
      child = spawn("tail", args);
    }

    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.on("close", () => {
      res.json({ content: output });
    });
  }
});

export default rasplogsRouter;