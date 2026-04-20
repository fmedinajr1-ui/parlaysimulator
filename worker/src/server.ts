// ──────────────────────────────────────────────────────────────────────────────
// TikTok Remotion Worker — HTTP server
// ──────────────────────────────────────────────────────────────────────────────
// Receives a /render job from Lovable Cloud, composites with Remotion, uploads
// the MP4 to the tiktok-renders bucket, and POSTs back to the callback URL.
//
// Single-job-at-a-time. For higher throughput, run multiple instances behind a
// queue (Render auto-scales by request).
// ──────────────────────────────────────────────────────────────────────────────

import express from 'express';
import { randomUUID } from 'node:crypto';
import { renderJob } from './render.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.PORT || 8787);
const WORKER_SECRET = process.env.WORKER_SECRET;

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/render', async (req, res) => {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!WORKER_SECRET || token !== WORKER_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { render_id, script_id, composition, callback_url, callback_secret, props } = req.body || {};
  if (!render_id || !composition || !callback_url || !props) {
    return res.status(400).json({ error: 'missing fields' });
  }

  const jobId = randomUUID();
  res.json({ job_id: jobId });

  // Run async — don't block the response
  renderJob({ jobId, renderId: render_id, scriptId: script_id, composition, callbackUrl: callback_url, callbackSecret: callback_secret, props })
    .catch((err) => {
      console.error(`[worker] render ${render_id} failed:`, err);
    });
});

app.listen(PORT, () => {
  console.log(`[worker] listening on :${PORT}`);
});