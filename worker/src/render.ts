// ──────────────────────────────────────────────────────────────────────────────
// Render a single job: bundle the Remotion project, render the MP4, upload to
// Supabase Storage, then POST the callback.
// ──────────────────────────────────────────────────────────────────────────────

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const BUCKET = process.env.STORAGE_BUCKET || 'tiktok-renders';

let cachedBundleUrl: string | null = null;

async function getBundleUrl(): Promise<string> {
  if (cachedBundleUrl) return cachedBundleUrl;
  // Remotion entry point lives at remotion/src/index.ts inside this worker
  cachedBundleUrl = await bundle({
    entryPoint: path.resolve(__dirname, '../remotion/src/index.ts'),
    webpackOverride: (c) => c,
  });
  return cachedBundleUrl;
}

export interface RenderJobInput {
  jobId: string;
  renderId: string;
  scriptId: string;
  composition: string;
  callbackUrl: string;
  callbackSecret: string;
  props: any;
}

export async function renderJob(input: RenderJobInput): Promise<void> {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const tmpOut = path.join(os.tmpdir(), `tt-${input.renderId}.mp4`);

  try {
    const serveUrl = await getBundleUrl();

    const browser = await openBrowser('chrome', {
      browserExecutable: process.env.REMOTION_CHROMIUM_EXECUTABLE || '/usr/bin/chromium',
      chromiumOptions: { args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] },
    });

    const composition = await selectComposition({
      serveUrl,
      id: input.composition,
      inputProps: input.props,
      puppeteerInstance: browser,
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: tmpOut,
      inputProps: input.props,
      puppeteerInstance: browser,
      concurrency: 1,
    });

    await browser.close({ silent: false } as any);

    // Upload final MP4
    const finalPath = `renders/${input.renderId}.mp4`;
    const bytes = await fs.readFile(tmpOut);
    const { error: upErr } = await sb.storage.from(BUCKET).upload(finalPath, bytes, {
      contentType: 'video/mp4', upsert: true,
    });
    if (upErr) throw upErr;

    // Estimate cost: ~$0.04 / video (Render free-tier compute is free; this
    // mainly tracks downstream provider costs already booked elsewhere).
    await postCallback(input.callbackUrl, input.callbackSecret, {
      render_id: input.renderId,
      status: 'completed',
      final_video_path: finalPath,
      cost_usd: 0,
    });
  } catch (err: any) {
    console.error(`[worker] job ${input.jobId} failed:`, err);
    await postCallback(input.callbackUrl, input.callbackSecret, {
      render_id: input.renderId,
      status: 'failed',
      error: String(err?.message || err),
    });
  } finally {
    await fs.unlink(tmpOut).catch(() => {});
  }
}

async function postCallback(url: string, secret: string, body: any): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}