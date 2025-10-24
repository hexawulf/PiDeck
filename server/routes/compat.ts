import { Router } from "express";

const compatRouter = Router();

// Compatibility endpoints - always return empty data to prevent 404s
compatRouter.get(["/hostlogs", "/logs"], (_req, res) => {
  res.json([]);
});

compatRouter.get("/hostlogs/:name", (_req, res) => {
  res.json({ content: "" });
});

compatRouter.get("/system/alerts", (_req, res) => {
  res.json([]);
});

export default compatRouter;