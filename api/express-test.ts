import express from "express";

const app = express();
app.get("/api/express-test", (req, res) => {
  res.json({ ok: true, url: req.url, headers: req.headers["x-vercel-rewrite-source"] || null });
});

export default app;
