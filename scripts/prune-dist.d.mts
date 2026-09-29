// Types for scripts/prune-dist.mjs (plain JS: it runs inside `npm run build:server`).
export const DIST: string;
export const META: string;
export const PREV_META: string;
export function chunksToDelete(files: string[], currentOutputs: string[], previousOutputs?: string[]): string[];
export function main(argv?: string[], dist?: string, log?: (m: string) => void): number;
