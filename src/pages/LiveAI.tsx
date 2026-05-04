import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Mic, MicOff, Loader2, Upload, PawPrint } from "lucide-react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { DogAvatarVideo } from "@/components/live-ai/DogAvatarVideo";
import { AIParlayCard } from "@/components/live-ai/AIParlayCard";
import { SpikeShareCard } from "@/components/live-ai/SpikeShareCard";
import { Seo } from "@/components/seo/Seo";
import { toast } from "@/hooks/use-toast";

type RiskMode = "aggressive" | "smart" | "safe" | "fade";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  parlay?: any;
  shareLink?: string | null;
}

const RISK_MODES: { id: RiskMode; label: string; emoji: string }[] = [
  { id: "aggressive", label: "Aggressive", emoji: "🔥" },
  { id: "smart", label: "Smart", emoji: "🧠" },
  { id: "safe", label: "Safe", emoji: "🛡️" },
  { id: "fade", label: "Fade Me", emoji: "🚫" },
];

export default function LiveAI() {
  const { user } = useAuth();
  const { token: routeToken } = useParams<{ token?: string }>();
  // Open access: Spike is fully usable on the site without signing in.
  // `sample` flag is kept for the agent so anonymous-only tools stay gated,
  // but we no longer cap turns or push users to sign up.
  const sampleMode = !user && !routeToken;
  const sampleTurns = 0;
  const sampleExhausted = false;
  const [messages, setMessages] = useState<Msg[]>([
  ]);
  const [riskMode, setRiskMode] = useState<RiskMode>("smart");
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [outputVolume, setOutputVolume] = useState(0);
  const [speakingVideoUrl, setSpeakingVideoUrl] = useState<string | null>(null);
  const [partialText, setPartialText] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [woken, setWoken] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [shareCardDismissed, setShareCardDismissed] = useState(false);

  // /spike/:token deeplinks are open — anyone with the link can chat with Spike.

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Init conversation row (signed-in only)
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("live_ai_conversations")
          .insert({ user_id: user.id })
          .select("id")
          .single();
        if (error) throw error;
        setConversationId(data.id);
      } catch (e) {
        console.warn("[LiveAI] conversation init failed", e);
      }
    })();
  }, [user]);

  // Autoscroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, partialText]);

  const persistMessage = useCallback(
    async (role: "user" | "assistant", content: string, parlay?: any) => {
      if (!conversationId || !user) return;
      try {
        await supabase.from("live_ai_messages").insert({
          conversation_id: conversationId,
          user_id: user.id,
          role,
          content,
          tool_result: parlay ? (parlay as any) : null,
        });
      } catch (e) {
        console.warn("[LiveAI] persist message failed", e);
      }
    },
    [conversationId, user],
  );

  const playTTS = useCallback(async (text: string) => {
    try {
      const supaUrl = (import.meta as any).env.VITE_SUPABASE_URL;
      const anonKey = (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? anonKey;
      const r = await fetch(`${supaUrl}/functions/v1/live-ai-tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);

      // Setup analyser for volume-driven avatar pulse
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      // iOS: resume if suspended
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      const src = audioCtxRef.current.createMediaElementSource(audio);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(audioCtxRef.current.destination);
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        setOutputVolume(sum / buf.length / 255);
        animationRef.current = requestAnimationFrame(tick);
      };
      tick();

      setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        setOutputVolume(0);
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (e) {
      console.error("[LiveAI] TTS error", e);
      setIsSpeaking(false);
    }
  }, []);

  const requestAvatarVideo = useCallback(async (text: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("live-ai-avatar-render", {
        body: { text },
      });
      if (error) throw error;
      if (data?.video_url) setSpeakingVideoUrl(data.video_url);
    } catch (e) {
      console.warn("[LiveAI] avatar render unavailable", e);
    }
  }, []);

  const sendToAgent = useCallback(
    async (userText: string) => {
      const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: userText };
      setMessages((m) => [...m, userMsg]);
      persistMessage("user", userText);
      setIsThinking(true);
      setSpeakingVideoUrl(null);
      try {
        const { data, error } = await supabase.functions.invoke("live-ai-agent", {
          body: {
            user_text: userText,
            mode: riskMode,
            conversation_id: conversationId,
            sample: sampleMode,
            history: messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
          },
        });
        if (error) throw error;
        const reply: string = data?.text ?? data?.reply ?? "Hmm, no read on that. Try again.";
        const parlay = data?.parlay ?? null;
        const shareLink: string | null = data?.share_link ?? null;
        const aiMsg: Msg = { id: crypto.randomUUID(), role: "assistant", content: reply, parlay, shareLink };
        setMessages((m) => [...m, aiMsg]);
        persistMessage("assistant", reply, parlay);
        // Fire TTS in parallel — skip avatar render path for now (HeyGen v2)
        playTTS(reply);
      } catch (e: any) {
        console.error("[LiveAI] agent error", e);
        toast({
          title: "Spike couldn't think straight",
          description: e?.message ?? "Try again in a sec.",
          variant: "destructive",
        });
      } finally {
        setIsThinking(false);
      }
    },
    [riskMode, conversationId, messages, persistMessage, playTTS, sampleMode, sampleTurns],
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) return;
        // Send to STT
        try {
          setIsThinking(true);
          const fd = new FormData();
          fd.append("audio", blob, "clip.webm");
          const supaUrl = (import.meta as any).env.VITE_SUPABASE_URL;
          const anonKey = (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY;
          const { data: sess } = await supabase.auth.getSession();
          const token = sess.session?.access_token ?? anonKey;
          const r = await fetch(`${supaUrl}/functions/v1/live-ai-stt-token`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
            body: fd,
          });
          const out = await r.json();
          const text = out?.text?.trim();
          if (text) {
            setPartialText("");
            await sendToAgent(text);
          } else {
            toast({ title: "Didn't catch that", description: "Try again." });
          }
        } catch (e) {
          console.error("[LiveAI] STT failed", e);
          toast({ title: "Couldn't transcribe", variant: "destructive" });
        } finally {
          setIsThinking(false);
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
    } catch (e) {
      console.error("[LiveAI] mic error", e);
      toast({
        title: "Mic blocked",
        description: "Allow microphone access to talk to Spike.",
        variant: "destructive",
      });
    }
  }, [sendToAgent]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  const handleSlipUpload = useCallback(
    async (file: File) => {
      if (!file) return;
      try {
        setIsScanning(true);
        // Convert to data URL
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Show user-side bubble immediately
        const placeholderId = crypto.randomUUID();
        setMessages((m) => [
          ...m,
          { id: placeholderId, role: "user", content: "📸 Uploaded a slip — score it Spike." },
        ]);

        const { data, error } = await supabase.functions.invoke("live-ai-slip-scan", {
          body: { image_data_url: dataUrl },
        });
        if (error) throw error;
        const legs: any[] = data?.legs ?? [];
        if (!legs.length) {
          toast({ title: "Couldn't read that slip", description: "Try a clearer screenshot.", variant: "destructive" });
          return;
        }
        const summary = legs
          .map(
            (l, i) =>
              `${i + 1}. ${l.player_name} ${l.side?.toUpperCase()} ${l.line} ${l.prop_type}${
                l.american_odds ? ` (${l.american_odds > 0 ? "+" : ""}${l.american_odds})` : ""
              }`,
          )
          .join("\n");
        const prompt = `Here's my slip${data?.sportsbook ? ` from ${data.sportsbook}` : ""}:\n${summary}\n\nGrade it leg-by-leg, flag traps, and tell me what to swap.`;
        await sendToAgent(prompt);
      } catch (e: any) {
        console.error("[LiveAI] slip scan error", e);
        toast({
          title: "Slip scan failed",
          description: e?.message ?? "Try again.",
          variant: "destructive",
        });
      } finally {
        setIsScanning(false);
      }
    },
    [sendToAgent],
  );

  // Wake Spike — first user gesture unlocks audio + plays the greeting.
  const wakeSpike = useCallback(async () => {
    if (woken) return;
    setWoken(true);
    try {
      // Pre-create AudioContext on the user gesture (iOS requirement)
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      const greeting =
        "Yo, what's good? Spike here. Tap the mic, drop a slip, whatever you got — I'm ready.";
      const aiMsg: Msg = { id: crypto.randomUUID(), role: "assistant", content: greeting };
      setMessages([aiMsg]);
      await playTTS(greeting);
    } catch (e) {
      console.warn("[LiveAI] wake failed", e);
    }
  }, [woken, playTTS]);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden flex flex-col">
      <Seo
        title="Live AI — Spike"
        description="Talk live to ParlayFarm's AI bulldog."
        canonical="/live-ai"
      />

      {/* Full-screen avatar background */}
      <div className="absolute inset-0">
        <DogAvatarVideo
          speakingVideoUrl={speakingVideoUrl}
          isSpeaking={isSpeaking}
          outputVolume={outputVolume}
        />
      </div>

      {/* Top fade + risk pills (hidden until Spike is awake to prevent overlap) */}
      {woken && (
      <div className="relative z-10 pt-safe pt-3 px-3 flex justify-end gap-1 bg-gradient-to-b from-black/50 to-transparent pb-12">
        {RISK_MODES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRiskMode(r.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-mono backdrop-blur transition ${
              riskMode === r.id ? "bg-primary text-primary-foreground shadow-lg" : "bg-black/60 text-white"
            }`}
          >
            {r.emoji} {r.label}
          </button>
        ))}
      </div>
      )}

      {/* Open access: no signup banner. Spike chats freely with anyone on the site. */}

      <div className="flex-1" />

      {/* Transcript overlay (bottom 45%) */}
      <div
        ref={scrollRef}
        className="relative z-10 max-h-[42vh] overflow-y-auto px-4 pb-2 space-y-2"
        style={{
          maskImage: "linear-gradient(to bottom, transparent, black 14%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, black 14%)",
        }}
      >
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-2 backdrop-blur shadow-lg ${
                m.role === "user"
                  ? "bg-primary/85 text-primary-foreground"
                  : "bg-zinc-900/75 text-white"
              }`}
            >
              {m.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none [&_p]:my-0">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm leading-snug">{m.content}</p>
              )}
              {m.parlay && (
                <div className="mt-2">
                  <AIParlayCard parlay={m.parlay} />
                </div>
              )}
              {m.shareLink && (
                <div className="mt-2">
                  <SpikeShareCard url={m.shareLink} variant="inline" />
                </div>
              )}
            </div>
          </div>
        ))}
        {isThinking && (
          <div className="flex items-center gap-2 text-white/80 text-sm pl-1">
            <Loader2 className="w-4 h-4 animate-spin" /> Spike's cookin'…
          </div>
        )}
      </div>

      {/* Glass control bar */}
      <div className="relative z-10 px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] flex flex-col items-center gap-3 bg-gradient-to-t from-black/85 via-black/60 to-transparent">
        {woken && user && !shareCardDismissed && messages.length <= 2 && (
          <div className="w-full max-w-sm relative">
            <button
              onClick={() => setShareCardDismissed(true)}
              className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-black/80 text-white text-[10px] flex items-center justify-center hover:bg-black"
              aria-label="Dismiss"
            >
              ×
            </button>
            <SpikeShareCard />
          </div>
        )}
        <>
        <Badge variant="outline" className="text-xs bg-black/60 border-white/20 text-white">
          {RISK_MODES.find((r) => r.id === riskMode)?.emoji} {riskMode} mode
        </Badge>
        <div className="flex items-center gap-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleSlipUpload(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isThinking || isScanning || isRecording}
            className="w-14 h-14 rounded-full flex items-center justify-center bg-white/10 backdrop-blur border border-white/20 hover:bg-white/20 transition disabled:opacity-50"
            aria-label="Upload slip"
          >
            {isScanning ? (
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            ) : (
              <Upload className="w-6 h-6 text-white" />
            )}
          </button>
          <button
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            disabled={isThinking || isScanning}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${
              isRecording
                ? "bg-destructive scale-110 animate-pulse"
                : "bg-primary hover:scale-105"
            } ${isThinking || isScanning ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {isRecording ? (
              <MicOff className="w-8 h-8 text-white" />
            ) : (
              <Mic className="w-8 h-8 text-primary-foreground" />
            )}
          </button>
        </div>
        <p className="text-xs text-white/70">
          {isScanning
            ? "Reading your slip…"
            : isRecording
              ? "Release to send"
              : sampleMode
                ? "Hold mic to talk · Sample mode (chat only)"
                : "Hold mic to talk · Tap upload for a slip"}
        </p>
        </>
      </div>

      {/* Wake-up overlay (first tap unlocks audio + plays greeting).
          Perf: avoid backdrop-blur and blurred glow — both repaint every frame
          on low-end Android. Use a flat scrim + transform-only transitions. */}
      {!woken && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6 bg-black/75">
          <button
            onClick={wakeSpike}
            style={{ willChange: "transform" }}
            className="relative inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg shadow-lg ring-1 ring-white/20 transition-transform duration-150 active:scale-[0.98]"
          >
            <PawPrint className="w-5 h-5" />
            <span>Tap to wake Spike up</span>
            <span aria-hidden className="text-xl">🐶</span>
          </button>
          <p className="mt-4 text-sm text-white/80">He'll say hi in a NY accent</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 max-w-sm">
            <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] text-white/85">💬 Ask anything</span>
            <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] text-white/85">📚 Bet education</span>
            <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] text-white/85">🔒 Today's plays for members</span>
          </div>
        </div>
      )}
    </div>
  );
}