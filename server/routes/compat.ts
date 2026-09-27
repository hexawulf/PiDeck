import { Router } from "express";

const compatRouter = Router();

// Compatibility endpoints - always return empty data to prevent 404s.
// /logs is also a SPA route (the Logs tab): browser navigations fall through
// to the SPA fallback, only API-style callers get the stub.
compatRouter.get(["/hostlogs", "/logs"], (req, res, next) => {
  if (req.accepts(["json", "html"]) === "html") return next();
  res.json([]);
});

compatRouter.get("/hostlogs/:name", (_req, res) => {
  res.json({ content: "" });
});

compatRouter.get("/system/alerts", (_req, res) => {
  res.json([]);
});

export default compatRouter;