import { Router } from "express";

const compatRouter = Router();

// Alias /api/hostlogs and /api/logs to /api/rasplogs
compatRouter.get(["/hostlogs", "/logs"], (_req, res) => {
  res.redirect(301, "/api/rasplogs");
});

// Alias /api/hostlogs/:name to /api/rasplogs/:name
compatRouter.get("/hostlogs/:name", (req, res) => {
  const { name } = req.params;
  const query = req.url.split("?")[1];
  res.redirect(301, `/api/rasplogs/${name}${query ? `?${query}` : ""}`);
});

// Alias /api/system/alerts to return an empty array
compatRouter.get("/system/alerts", (_req, res) => {
  res.json([]);
});

export default compatRouter;