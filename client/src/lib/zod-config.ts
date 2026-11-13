// zod 4 compiles object parsers with `new Function` when it can, and finds
// out by trying. PiDeck enforces a CSP without `unsafe-eval`: the attempt is
// blocked (harmless) but every page load would report a violation to
// /csp-report. `jitless` skips both the probe and the compiled path.
// Imported first in main.tsx, before any schema parses.
import { z } from "zod";

z.config({ jitless: true });
