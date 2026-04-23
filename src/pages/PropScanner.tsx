// @ts-nocheck
import { useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Camera, Image as ImageIcon, Monitor, Loader2, Sparkles, Square, Upload } from "lucide-react";
import { toast } from "sonner";
import { useOcrScanSession, uploadFramesForOcr, buildParlaysFromPool } from "@/hooks/useOcrScanSession";
import { compressImage } from "@/lib/image-compression";

const SPORTS = ["nba", "mlb", "nfl", "nhl"];
const BOOKS = [
  { id: "fanduel", label: "FanDuel" },
  { id: "draftkings", label: "DraftKings" },
  { id: "hardrock", label: "Hard Rock Bet" },
  { id: "prizepicks", label: "PrizePicks" },
  { id: "underdog", label: "Underdog" },
];

async function fileToDataUrl(file: File): Promise<string> {
  const compressed = await compressImage(file, { enableOCRPreprocessing: true });
  return compressed.base64.startsWith("data:") ? compressed.base64 : `data:image/jpeg;base64,${compressed.base64}`;
}

export default function PropScanner() {
  const { session, props, startSession, finalizeSession, toggleSelected } = useOcrScanSession();
  const [sport, setSport] = useState("nba");
  const [book, setBook] = useState("fanduel");
  const [mode, setMode] = useState<"screenshots" | "recording" | "camera">("screenshots");
  const [scanning, setScanning] = useState(false);
  const [parlays, setParlays] = useState<any[]>([]);
  const [building, setBuilding] = useState(false);

  // Recording state
  const [recording, setRecording] = useState(false);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordIntervalRef = useRef<number | null>(null);

  const handleStart = async () => {
    try { await startSession(sport, book, mode); toast.success("Scan session started"); }
    catch (e: any) { toast.error(e.message); }
  };

  const submitFrames = useCallback(async (frames: string[]) => {
    if (!session) { toast.error("Start a session first"); return; }
    setScanning(true);
    try {
      const res: any = await uploadFramesForOcr({ session_id: session.id, frames, book: session.book, sport: session.sport });
      if (res?.ok) toast.success(`${res.parsed} prop(s) captured (${res.inserted} new)`);
      else toast.error(`OCR failed: ${res?.error}`);
    } catch (e: any) { toast.error(e.message); }
    finally { setScanning(false); }
  }, [session]);

  // SCREENSHOTS — drop / paste
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const frames: string[] = [];
    for (const f of Array.from(files).slice(0, 6)) frames.push(await fileToDataUrl(f));
    await submitFrames(frames);
  };

  // RECORDING — getDisplayMedia + 1 fps capture
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1280 } }, audio: false });
      recordStreamRef.current = stream;
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      setRecording(true);
      const buffer: string[] = [];
      recordIntervalRef.current = window.setInterval(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = Math.round((video.videoHeight / video.videoWidth) * 1280) || 720;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        buffer.push(canvas.toDataURL("image/jpeg", 0.85));
        if (buffer.length >= 4) {
          const batch = buffer.splice(0, buffer.length);
          await submitFrames(batch);
        }
      }, 1500);
      stream.getVideoTracks()[0].addEventListener("ended", stopRecording);
    } catch (e: any) { toast.error(`Recording denied: ${e.message}`); }
  };
  const stopRecording = () => {
    if (recordIntervalRef.current) { clearInterval(recordIntervalRef.current); recordIntervalRef.current = null; }
    recordStreamRef.current?.getTracks().forEach(t => t.stop());
    recordStreamRef.current = null;
    setRecording(false);
  };

  // CAMERA
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) { cameraVideoRef.current.srcObject = stream; await cameraVideoRef.current.play(); }
    } catch (e: any) { toast.error(`Camera denied: ${e.message}`); }
  };
  const captureCameraFrame = async () => {
    const video = cameraVideoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    await submitFrames([canvas.toDataURL("image/jpeg", 0.9)]);
  };

  // Build parlays
  const handleAutoBuild = async () => {
    if (!session) return;
    setBuilding(true);
    try {
      const res: any = await buildParlaysFromPool({ session_id: session.id, mode: "auto", target_legs: 3 });
      setParlays(res?.parlays ?? []);
      if (!res?.parlays?.length) toast.message("No parlays — capture more props");
    } catch (e: any) { toast.error(e.message); }
    finally { setBuilding(false); }
  };
  const handleManualBuild = async () => {
    if (!session) return;
    const selected = props.filter(p => p.selected_for_parlay).map(p => p.id);
    if (selected.length < 2) { toast.error("Select at least 2 props"); return; }
    setBuilding(true);
    try {
      const res: any = await buildParlaysFromPool({ session_id: session.id, mode: "manual", selected_prop_ids: selected, target_legs: selected.length });
      setParlays(res?.parlays ?? []);
    } catch (e: any) { toast.error(e.message); }
    finally { setBuilding(false); }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Prop Scanner</h1>
            <p className="text-muted-foreground text-sm">OCR your sportsbook → cross-reference DNA + sweet spots → build parlays</p>
          </div>
          {session ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Sparkles className="h-3 w-3" /> {session.sport.toUpperCase()} · {session.book} · {props.length} props
              </Badge>
              <Button variant="outline" size="sm" onClick={finalizeSession}>End session</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={sport} onValueChange={setSport}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{SPORTS.map(s => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={book} onValueChange={setBook}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{BOOKS.map(b => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={handleStart}>Start session</Button>
            </div>
          )}
        </div>

        {session && (
          <>
            <Card className="p-4">
              <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
                <TabsList>
                  <TabsTrigger value="screenshots"><ImageIcon className="h-4 w-4 mr-1" />Screenshots</TabsTrigger>
                  <TabsTrigger value="recording"><Monitor className="h-4 w-4 mr-1" />Record screen</TabsTrigger>
                  <TabsTrigger value="camera"><Camera className="h-4 w-4 mr-1" />Camera</TabsTrigger>
                </TabsList>
                <TabsContent value="screenshots" className="mt-4">
                  <label className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/30 transition">
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <span className="text-sm text-muted-foreground">Drop or click to upload screenshots (max 6 / batch)</span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                  </label>
                </TabsContent>
                <TabsContent value="recording" className="mt-4">
                  <div className="flex items-center gap-3">
                    {!recording ? (
                      <Button onClick={startRecording}><Monitor className="h-4 w-4 mr-1" />Share sportsbook tab</Button>
                    ) : (
                      <Button variant="destructive" onClick={stopRecording}><Square className="h-4 w-4 mr-1" />Stop</Button>
                    )}
                    <span className="text-sm text-muted-foreground">{recording ? "Capturing 1 frame / 1.5 s" : "Click to share your sportsbook browser tab"}</span>
                  </div>
                </TabsContent>
                <TabsContent value="camera" className="mt-4 space-y-3">
                  <video ref={cameraVideoRef} className="w-full max-h-[360px] rounded bg-muted" muted playsInline />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={startCamera}>Start camera</Button>
                    <Button onClick={captureCameraFrame}><Camera className="h-4 w-4 mr-1" />Freeze + scan</Button>
                  </div>
                </TabsContent>
              </Tabs>
              {scanning && (
                <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> OCR + cross-reference running…
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Session pool ({props.length})</h2>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleManualBuild} disabled={building}>
                    Build from selected
                  </Button>
                  <Button size="sm" onClick={handleAutoBuild} disabled={building}>
                    {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Sparkles className="h-4 w-4 mr-1" />Auto-parlay</>}
                  </Button>
                </div>
              </div>
              <ScrollArea className="h-[320px]">
                <div className="space-y-2">
                  {props.length === 0 && <p className="text-sm text-muted-foreground">Capture some props to populate the pool.</p>}
                  {props.map(p => {
                    const odds = p.side === "over" ? p.over_price : p.under_price;
                    const flag = p.blocked ? "bg-destructive/15 text-destructive" : (p.dna_score ?? 0) >= 70 ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500";
                    return (
                      <div key={p.id} className="flex items-start gap-3 p-3 rounded border border-border">
                        <Checkbox checked={p.selected_for_parlay} disabled={p.blocked} onCheckedChange={(v) => toggleSelected(p.id, !!v)} className="mt-1" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{p.player_name}</span>
                            <span className="text-sm text-muted-foreground">{p.prop_type} {p.side.toUpperCase()} {p.line}{odds != null ? ` (${odds > 0 ? "+" : ""}${odds})` : ""}</span>
                            <Badge className={flag}>DNA {p.dna_score ?? "—"}</Badge>
                            {p.l10_hit_rate != null && <Badge variant="outline">L10 {(p.l10_hit_rate * 100).toFixed(0)}%</Badge>}
                            {p.source_channel === "telegram" && <Badge variant="outline">via Telegram</Badge>}
                          </div>
                          {p.blocked && <p className="text-xs text-destructive mt-1">Blocked: {p.block_reason}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </Card>

            {parlays.length > 0 && (
              <Card className="p-4 space-y-4">
                <h2 className="font-semibold">Generated parlays</h2>
                {parlays.map((p: any, i: number) => (
                  <div key={i} className="border border-border rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">Ticket {i + 1}</span>
                      <span className="text-sm text-muted-foreground">
                        {p.american_odds > 0 ? "+" : ""}{p.american_odds} · composite {p.composite_score} · {p.distinct_games} games
                      </span>
                    </div>
                    <div className="space-y-1 text-sm">
                      {p.legs.map((l: any, idx: number) => (
                        <div key={idx}>
                          <span className="font-medium">{idx + 1}. {l.player_name}</span>{" "}
                          {l.prop_type} {l.side.toUpperCase()} {l.line} ({l.odds > 0 ? "+" : ""}{l.odds})
                          <div className="text-xs text-muted-foreground ml-4">{l.reasoning}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}