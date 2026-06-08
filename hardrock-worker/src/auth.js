// Bearer-token middleware. Every scrape route requires
// `Authorization: Bearer <HARDROCK_WORKER_SECRET>`. /health stays public.
export function requireBearer(req, res, next) {
  const expected = process.env.HARDROCK_WORKER_SECRET ?? "";
  if (!expected) {
    return res.status(503).json({ ok: false, error: "worker_secret_not_configured" });
  }
  const got = req.header("authorization") ?? "";
  if (got !== `Bearer ${expected}`) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}