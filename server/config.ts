import path from "path";

const HOME = process.env.HOME || "/home/zk";

export const PIDECK_LOGS_DIR = process.env.PIDECK_LOGS_DIR || path.join(HOME, "logs");
export const PM2_LOGS_DIR = process.env.PM2_LOGS_DIR || path.join(HOME, ".pm2/logs");
