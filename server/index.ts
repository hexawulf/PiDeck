// server/index.ts — entry point. PIDECK_MODE=agent starts the read-only
// agent (server/agent.ts); anything else the full hub (server/hub.ts).
// Both are dynamic imports so the agent never loads the hub's modules
// (sessions, ./storage, Postgres); esbuild keeps them lazy in the bundle.
import "./env";
import { agentConfig, isAgentMode } from "./config";

if (isAgentMode()) {
  const cfg = agentConfig();
  if ("error" in cfg) {
    console.error(`[agent] refusing to start: ${cfg.error}`);
    process.exit(1);
  }
  const { startAgent } = await import("./agent");
  startAgent(cfg);
} else {
  await import("./hub");
}
