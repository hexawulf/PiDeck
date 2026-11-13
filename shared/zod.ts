// The one place the browser code gets `z` from.
//
// zod 4 compiles object parsers with `new Function` when it can, and finds
// out by trying, once, when the first object schema is *constructed*.
// PiDeck enforces a CSP without `unsafe-eval`: the attempt is blocked
// (harmless), but every page load would report a violation to /csp-report.
// `jitless` skips the probe and the compiled path.
//
// It has to be set before any schema exists. Module order across bundler
// chunks does not guarantee that for a side-effect import in main.tsx (the
// first attempt failed that way), but a module always runs after the modules
// it imports: so every file that builds schemas imports `z` from here.
// Type-only imports (`import type { z } from "zod"`) are fine anywhere.
// The server keeps the default: Node has no CSP.
import { z } from "zod";

if (typeof window !== "undefined") z.config({ jitless: true });

export { z };
