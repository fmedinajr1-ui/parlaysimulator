// @ts-nocheck
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdminRole } from "@/hooks/useAdminRole";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Sparkles, Check, X, RefreshCw, Film } from "lucide-react";
import PublishTab from "@/components/admin/tiktok/PublishTab";
import HookLabTab from "@/components/admin/tiktok/HookLabTab";

export default function AdminTikTok() {
  const { isAdmin, isLoading } = useAdminRole();
  const navigate = useNavigate();
  const [scripts, setScripts] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [hooks, setHooks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [renders, setRenders] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!isLoading && !isAdmin) navigate("/");
  }, [isAdmin, isLoading, navigate]);

  useEffect(() => { if (isAdmin) loadAll(); }, [isAdmin]);

  async function loadAll() {
    const [s, a, h, l, r, p] = await Promise.all([
      supabase.from("tiktok_video_scripts").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("tiktok_accounts").select("*").order("persona_key"),
      supabase.from("tiktok_hook_performance").select("*").order("avg_completion_rate", { ascending: false }),
      supabase.from("tiktok_pipeline_logs").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("tiktok_video_renders").select("*").order("created_at", { ascending: false }).limit(30),
      supabase.from("tiktok_posts").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    setScripts(s.data || []);
    setAccounts(a.data || []);
    setHooks(h.data || []);
    setLogs(l.data || []);
    setRenders(r.data || []);
    setPosts(p.data || []);
  }

  async function runGenerator() {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiktok-script-generator", { body: {} });
      if (error) throw error;
      toast.success(`Generated ${data?.generated || 0} script(s) — ${data?.rejected || 0} rejected`);
      await loadAll();
    } catch (e: any) {
      toast.error(`Generation failed: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function approveScript(id: string) {
    const { error } = await supabase.from("tiktok_video_scripts").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Approved"); loadAll(); }
  }
  async function rejectScript(id: string) {
    const { error } = await supabase.from("tiktok_video_scripts").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Rejected"); loadAll(); }
  }
  async function updateAccountStatus(id: string, status: string) {
    const { error } = await supabase.from("tiktok_accounts").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Updated"); loadAll(); }
  }
  async function toggleHook(id: string, active: boolean) {
    const { error } = await supabase.from("tiktok_hook_performance").update({ active: !active }).eq("id", id);
    if (error) toast.error(error.message); else loadAll();
  }
  async function reLint(id: string) {
    const { data, error } = await supabase.functions.invoke("tiktok-safety-gate", { body: { script_id: id } });
    if (error) toast.error(error.message); else { toast.success(`Re-linted: score ${data?.result?.score}`); loadAll(); }
  }
  async function renderScript(id: string) {
    toast.loading("Dispatching render...", { id: `render-${id}` });
    const { data, error } = await supabase.functions.invoke("tiktok-render-orchestrator", { body: { script_id: id } });
    toast.dismiss(`render-${id}`);
    if (error) toast.error(error.message);
    else { toast.success(`Render started — step: ${data?.step || "queued"}`); loadAll(); }
  }

  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!isAdmin) return null;

  const drafts = scripts.filter(s => s.status === "draft");
  const approved = scripts.filter(s => s.status === "approved");

  return (
    <div className="container mx-auto max-w-7xl p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">TikTok Pipeline</h1>
          <p className="text-sm text-muted-foreground">Script generation, safety gate, and persona management</p>
        </div>
        <Button onClick={runGenerator} disabled={generating}>
          {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
          Generate Scripts
        </Button>
      </div>

      <Tabs defaultValue="queue" className="w-full">
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="queue">Queue ({drafts.length})</TabsTrigger>
          <TabsTrigger value="renders">Renders ({renders.length})</TabsTrigger>
          <TabsTrigger value="publish">Publish</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="hooks">Hook Lab</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        {/* QUEUE TAB */}
        <TabsContent value="queue" className="space-y-3">
          {drafts.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No drafts pending. Click "Generate Scripts" to create new ones from today's picks.</CardContent></Card>}
          {drafts.map(s => (
            <Card key={s.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{s.template}</Badge>
                    <Badge>{s.target_persona_key}</Badge>
                    <Badge variant={s.compliance_score >= 90 ? "default" : s.compliance_score >= 75 ? "secondary" : "destructive"}>
                      Score: {s.compliance_score}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => reLint(s.id)}><RefreshCw className="w-3 h-3 mr-1" />Re-lint</Button>
                    <Button size="sm" variant="destructive" onClick={() => rejectScript(s.id)}><X className="w-3 h-3 mr-1" />Reject</Button>
                    <Button size="sm" onClick={() => approveScript(s.id)}><Check className="w-3 h-3 mr-1" />Approve</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Hook</div>
                  <div className="font-medium">{s.hook?.vo_text}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Beats</div>
                  <ol className="list-decimal list-inside space-y-1">
                    {(s.beats || []).map((b: any, i: number) => (
                      <li key={i}><span className="text-xs text-muted-foreground">[{b.visual}]</span> {b.vo_text}</li>
                    ))}
                  </ol>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase">CTA</div>
                  <div>{s.cta?.vo_text}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Caption</div>
                  <div className="italic">{s.caption_seed}</div>
                  <div className="text-xs text-muted-foreground mt-1">{(s.hashtag_seed || []).join(" ")}</div>
                </div>
                {s.lint_transforms?.length > 0 && (
                  <div className="text-xs text-muted-foreground border-t pt-2">
                    Auto-rewrites: {s.lint_transforms.map((t: any) => `"${t.from}" → "${t.to}"`).join(", ")}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {approved.length > 0 && (
            <div>
              <h3 className="font-semibold mt-6 mb-2">Approved ({approved.length})</h3>
              {approved.map(s => (
                <Card key={s.id} className="mb-2"><CardContent className="py-3 flex items-center justify-between text-sm">
                  <div><Badge variant="secondary" className="mr-2">{s.target_persona_key}</Badge>{s.hook?.vo_text}</div>
                  <Button size="sm" onClick={() => renderScript(s.id)}>
                    <Film className="w-3 h-3 mr-1" />Render
                  </Button>
                </CardContent></Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* RENDERS TAB — Preview audio + avatar + b-roll for QA */}
        <TabsContent value="renders" className="space-y-3">
          {renders.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No renders yet. Approve a script and click "Render" to start.</CardContent></Card>}
          {renders.map(r => (
            <Card key={r.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{r.id.slice(0, 8)}</Badge>
                    <Badge variant={
                      r.status === "completed" ? "default" :
                      r.status === "failed" ? "destructive" :
                      "secondary"
                    }>{r.status}</Badge>
                    <Badge variant="outline">step: {r.step}</Badge>
                    {r.audio_duration_sec && <span className="text-xs text-muted-foreground">{Number(r.audio_duration_sec).toFixed(1)}s</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {r.step === "awaiting_worker" && (
                  <div className="text-xs bg-secondary/50 p-2 rounded border">
                    ⏳ Worker not deployed yet — assets ready for QA. Final MP4 will render once <code>REMOTION_WORKER_URL</code> is configured.
                  </div>
                )}
                {r.error_message && r.status === "failed" && (
                  <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">{r.error_message}</div>
                )}
                {r.audio_url && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Narration</div>
                    <audio controls src={r.audio_url} className="w-full h-10" />
                  </div>
                )}
                {r.avatar_video_url && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Avatar</div>
                    <video controls src={r.avatar_video_url} className="w-full max-w-xs rounded" />
                  </div>
                )}
                {Array.isArray(r.broll_urls) && r.broll_urls.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">B-roll ({r.broll_urls.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {r.broll_urls.map((b: any, i: number) => (
                        <a key={i} href={b.url} target="_blank" rel="noopener noreferrer" className="text-xs underline">
                          beat #{b.beat_index}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {r.final_video_url && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Final MP4</div>
                    <video controls src={r.final_video_url} className="w-full max-w-xs rounded" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* PUBLISH TAB — Phase 3 manual delivery */}
        <TabsContent value="publish">
          <PublishTab
            renders={renders}
            scripts={scripts}
            accounts={accounts}
            onReload={loadAll}
          />
        </TabsContent>

        {/* ACCOUNTS TAB */}
        <TabsContent value="accounts" className="space-y-3">
          {accounts.map(a => (
            <Card key={a.id}>
              <CardContent className="py-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">{a.display_name}</div>
                    <div className="text-xs text-muted-foreground">{a.persona_key} • {a.hook_style}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant={a.status === "active" ? "default" : "outline"} onClick={() => updateAccountStatus(a.id, "active")}>Active</Button>
                    <Button size="sm" variant={a.status === "warming" ? "default" : "outline"} onClick={() => updateAccountStatus(a.id, "warming")}>Warming</Button>
                    <Button size="sm" variant={a.status === "paused" ? "destructive" : "outline"} onClick={() => updateAccountStatus(a.id, "paused")}>Paused</Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{a.tone_description}</p>
                <div className="text-xs text-muted-foreground">Hashtags: {(a.baseline_hashtags || []).join(" ")}</div>
                <div className="text-xs">Handle: {a.tiktok_handle || <span className="text-muted-foreground italic">not set</span>}</div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* HOOKS TAB */}
        <TabsContent value="hooks">
          <HookLabTab hooks={hooks} posts={posts} accounts={accounts} onReload={loadAll} />
        </TabsContent>

        {/* HEALTH TAB */}
        <TabsContent value="health">
          <Card><CardHeader><CardTitle className="text-base">Recent Pipeline Runs</CardTitle></CardHeader><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Gen</TableHead><TableHead className="text-right">Rej</TableHead>
                <TableHead className="text-right">Duration</TableHead><TableHead>Message</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {logs.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{new Date(l.created_at).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline">{l.run_type}</Badge></TableCell>
                    <TableCell><Badge variant={l.status === "success" ? "default" : l.status === "failed" ? "destructive" : "secondary"}>{l.status}</Badge></TableCell>
                    <TableCell className="text-right">{l.scripts_generated}</TableCell>
                    <TableCell className="text-right">{l.scripts_rejected}</TableCell>
                    <TableCell className="text-right text-xs">{l.duration_ms}ms</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.message}</TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No runs yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
