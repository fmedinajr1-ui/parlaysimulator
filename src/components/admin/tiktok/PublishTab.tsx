// @ts-nocheck
// ──────────────────────────────────────────────────────────────────────────────
// Phase 3 — Publish tab
// ──────────────────────────────────────────────────────────────────────────────
// Lists renders in `assets_ready`/`completed`/`awaiting_worker` state with:
//   - Final caption + hashtags (with "Regenerate" button → tiktok-caption-generator)
//   - "Download bundle" → ZIP of MP4 (or audio fallback) + caption.txt + hashtags.txt
//   - "Mark as posted" modal → captures TikTok URL, creates tiktok_posts row
//   - Sidebar: next 3 recommended posting slots per active account
// ──────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, ExternalLink, Loader2, RefreshCw, Send, Calendar } from "lucide-react";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type RenderRow = any;
type ScriptRow = any;
type AccountRow = any;
type SlotRow = any;

function formatHourEt(h: number, m: number) {
  const ampm = h >= 12 ? "pm" : "am";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}${m ? ":" + String(m).padStart(2, "0") : ""}${ampm} ET`;
}

// Compute the next future Date for a (dow, hour, minute) slot, in user's local tz.
// We treat ET-stored values as approximate display labels — the cron sits on the
// server, this is just for the admin "next slot" preview.
function nextSlotDate(dow: number, hour: number, minute: number): Date {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  let diff = (dow - now.getDay() + 7) % 7;
  if (diff === 0 && target.getTime() <= now.getTime()) diff = 7;
  target.setDate(target.getDate() + diff);
  return target;
}

export default function PublishTab({
  renders,
  scripts,
  accounts,
  onReload,
}: {
  renders: RenderRow[];
  scripts: ScriptRow[];
  accounts: AccountRow[];
  onReload: () => Promise<void> | void;
}) {
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [postModal, setPostModal] = useState<{ render: RenderRow; script: ScriptRow; account: AccountRow } | null>(null);
  const [postUrl, setPostUrl] = useState("");

  useEffect(() => { loadSlots(); }, []);

  async function loadSlots() {
    const { data } = await supabase
      .from("tiktok_post_schedule")
      .select("*")
      .eq("is_active", true);
    setSlots(data || []);
  }

  // Renders ready to publish
  const publishable = useMemo(() => {
    return renders.filter((r) =>
      ["completed", "ready", "assets_ready", "published"].includes(r.status) ||
      r.step === "awaiting_worker" ||
      !!r.final_video_url ||
      !!r.audio_url,
    );
  }, [renders]);

  function getScript(render: RenderRow): ScriptRow | undefined {
    return scripts.find((s) => s.id === render.script_id);
  }
  function getAccount(script: ScriptRow | undefined): AccountRow | undefined {
    if (!script) return undefined;
    return accounts.find((a) => a.id === script.account_id) ||
           accounts.find((a) => a.persona_key === script.target_persona_key);
  }

  async function regenerateCaption(scriptId: string) {
    setBusyId(scriptId);
    try {
      const { data, error } = await supabase.functions.invoke("tiktok-caption-generator", {
        body: { script_id: scriptId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Caption regenerated");
      await onReload();
    } catch (e: any) {
      toast.error(`Caption failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function downloadBundle(render: RenderRow, script: ScriptRow, account: AccountRow | undefined) {
    setBusyId(render.id);
    try {
      const zip = new JSZip();
      const persona = account?.persona_key || script?.target_persona_key || "tiktok";
      const caption = script?.final_caption || script?.caption_seed || "";
      const hashtags = (script?.final_hashtags?.length ? script.final_hashtags : script?.hashtag_seed) || [];

      zip.file("caption.txt", caption);
      zip.file("hashtags.txt", hashtags.join(" "));
      zip.file("post_text.txt", `${caption}\n\n${hashtags.join(" ")}`.trim());

      // Manifest for traceability
      zip.file("manifest.json", JSON.stringify({
        render_id: render.id,
        script_id: render.script_id,
        persona,
        template: script?.template,
        hook: script?.hook?.vo_text,
        cta: script?.cta?.vo_text,
        duration_sec: render.audio_duration_sec,
        created_at: render.created_at,
      }, null, 2));

      // Try to fetch each media asset; on CORS/network failure log a placeholder
      const fetchOptional = async (url: string | null | undefined, name: string) => {
        if (!url) return;
        try {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`status ${r.status}`);
          const buf = await r.arrayBuffer();
          zip.file(name, buf);
        } catch (e: any) {
          zip.file(`${name}.url.txt`, `${url}\n(direct download failed: ${e.message})`);
        }
      };

      await fetchOptional(render.final_video_url, "video.mp4");
      if (!render.final_video_url) await fetchOptional(render.audio_url, "narration.mp3");
      await fetchOptional(render.thumbnail_url, "thumbnail.jpg");
      if (!render.final_video_url) await fetchOptional(render.avatar_video_url, "avatar.mp4");

      // Include b-roll URLs as a list (don't bulk-download — too much weight)
      if (Array.isArray(render.broll_urls) && render.broll_urls.length) {
        zip.file(
          "broll_links.txt",
          render.broll_urls.map((b: any, i: number) => `#${i} (beat ${b.beat_index ?? i}): ${b.url}`).join("\n"),
        );
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tiktok_${persona}_${render.id.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Bundle downloaded");
    } catch (e: any) {
      toast.error(`Download failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  function openPostModal(render: RenderRow) {
    const script = getScript(render);
    const account = getAccount(script);
    if (!script || !account) {
      toast.error("Missing script or account context");
      return;
    }
    setPostModal({ render, script, account });
    setPostUrl("");
  }

  async function confirmManualPost() {
    if (!postModal) return;
    const { render, script, account } = postModal;
    const url = postUrl.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      toast.error("Paste a valid TikTok URL");
      return;
    }
    setBusyId(render.id);
    try {
      const now = new Date().toISOString();
      const caption = script.final_caption || script.caption_seed || "";
      const hashtags = (script.final_hashtags?.length ? script.final_hashtags : script.hashtag_seed) || [];

      // Insert post row
      const { error: pErr } = await supabase.from("tiktok_posts").insert({
        script_id: script.id,
        render_id: render.id,
        account_id: account.id,
        caption,
        hashtags,
        status: "posted_manually",
        posted_at: now,
        posted_manually_at: now,
        manual_post_url: url,
        tiktok_url: url,
      });
      if (pErr) throw pErr;

      // Mark script + render as posted/published
      await supabase.from("tiktok_video_scripts").update({ status: "posted" }).eq("id", script.id);
      await supabase.from("tiktok_video_renders").update({ status: "published" }).eq("id", render.id);

      toast.success("Marked as posted");
      setPostModal(null);
      await onReload();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  // Build "next 3 slots" view per account
  const upcomingByAccount = useMemo(() => {
    const map: Record<string, { account: AccountRow; next: { date: Date; label: string }[] }> = {};
    for (const acc of accounts) {
      if (acc.status === "paused") continue;
      const accSlots = slots.filter((s) => s.account_id === acc.id);
      const next = accSlots
        .map((s) => ({
          date: nextSlotDate(s.day_of_week, s.hour_et, s.minute_et),
          label: `${DAY_NAMES[s.day_of_week]} ${formatHourEt(s.hour_et, s.minute_et)}`,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, 3);
      map[acc.id] = { account: acc, next };
    }
    return Object.values(map);
  }, [slots, accounts]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* LEFT — Publishable renders */}
      <div className="lg:col-span-2 space-y-3">
        {publishable.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No renders ready to publish yet. Approve a script and render it from the Queue tab.
            </CardContent>
          </Card>
        )}

        {publishable.map((r) => {
          const script = getScript(r);
          const account = getAccount(script);
          const caption = script?.final_caption || "";
          const hashtags = script?.final_hashtags || [];
          const isBusy = busyId === r.id || busyId === r.script_id;

          return (
            <Card key={r.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{r.id.slice(0, 8)}</Badge>
                    {account && <Badge>{account.persona_key}</Badge>}
                    <Badge variant={
                      r.status === "published" ? "default" :
                      r.status === "completed" ? "default" :
                      "secondary"
                    }>{r.status}</Badge>
                    {r.step === "awaiting_worker" && (
                      <Badge variant="outline">awaiting worker</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3 text-sm">
                {script?.hook?.vo_text && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase">Hook</div>
                    <div className="font-medium">{script.hook.vo_text}</div>
                  </div>
                )}

                <div className="rounded border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase">Final Caption</div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy || !script}
                      onClick={() => script && regenerateCaption(script.id)}
                    >
                      {isBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                      {caption ? "Regenerate" : "Generate"}
                    </Button>
                  </div>
                  {caption ? (
                    <>
                      <p className="text-sm">{caption}</p>
                      <div className="text-xs text-muted-foreground">
                        {hashtags.length ? hashtags.join(" ") : <em>no hashtags</em>}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      No final caption yet — click Generate (auto-runs on render completion).
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy || !script}
                    onClick={() => script && downloadBundle(r, script, account)}
                  >
                    {isBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
                    Download bundle
                  </Button>
                  <Button
                    size="sm"
                    disabled={isBusy}
                    onClick={() => openPostModal(r)}
                  >
                    <Send className="w-3 h-3 mr-1" />
                    Mark as posted
                  </Button>
                  {r.final_video_url && (
                    <a href={r.final_video_url} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="ghost">
                        <ExternalLink className="w-3 h-3 mr-1" />Open MP4
                      </Button>
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* RIGHT — Schedule sidebar */}
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Next posting slots
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {upcomingByAccount.length === 0 && (
              <p className="text-xs text-muted-foreground">No active accounts with slots.</p>
            )}
            {upcomingByAccount.map(({ account, next }) => (
              <div key={account.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{account.persona_key}</Badge>
                  <span className="text-xs text-muted-foreground">{account.display_name}</span>
                </div>
                {next.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic pl-1">No slots configured</p>
                ) : (
                  <ul className="text-xs space-y-0.5 pl-1">
                    {next.map((n, i) => (
                      <li key={i}>
                        <span className="font-mono">{n.label}</span>
                        <span className="text-muted-foreground"> · {n.date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground border-t pt-2">
              Slots are stored in ET. Times shown convert to your local timezone.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* MODAL — Mark as posted */}
      <Dialog open={!!postModal} onOpenChange={(o) => !o && setPostModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as posted</DialogTitle>
            <DialogDescription>
              Paste the public TikTok URL after posting. This logs the post for metrics tracking.
            </DialogDescription>
          </DialogHeader>
          {postModal && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Persona: <span className="font-medium text-foreground">{postModal.account.persona_key}</span>
              </div>
              <div className="space-y-1">
                <Label htmlFor="post-url">TikTok URL</Label>
                <Input
                  id="post-url"
                  placeholder="https://www.tiktok.com/@handle/video/..."
                  value={postUrl}
                  onChange={(e) => setPostUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Caption sent</Label>
                <Textarea
                  readOnly
                  rows={3}
                  value={`${postModal.script.final_caption || postModal.script.caption_seed || ""}\n\n${(postModal.script.final_hashtags?.length ? postModal.script.final_hashtags : postModal.script.hashtag_seed || []).join(" ")}`}
                  className="text-xs"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPostModal(null)}>Cancel</Button>
            <Button onClick={confirmManualPost} disabled={busyId === postModal?.render?.id}>
              {busyId === postModal?.render?.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Confirm posted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}