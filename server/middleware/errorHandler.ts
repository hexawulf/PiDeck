import type { NextFunction, Request, Response } from "express";

/**
 * Global Express error handler (LOGGING-002).
 * Never exposes raw error messages on 5xx responses (DB errors, stack paths,
 * middleware internals); only explicit 4xx errors may return their message.
 */
export function createErrorHandler(logError: (err: unknown) => void = (err) => console.error(err)) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const httpErr = err as { status?: number; statusCode?: number; message?: string } | null;
    const rawStatus = httpErr?.status ?? httpErr?.statusCode;
    const status = typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
    const message = status >= 500 ? "Internal Server Error" : (httpErr?.message || "Bad Request");
    if (req.path.startsWith("/api")) {
      res.status(status).json({ message });
    } else {
      res.status(status).send(status >= 500 ? "Internal error" : message);
    }
    logError(err);
  };
}
