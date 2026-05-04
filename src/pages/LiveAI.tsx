import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DogAvatarVideo } from "@/components/live-ai/DogAvatarVideo";
import { AIParlayCard } from "@/components/live-ai/AIParlayCard";
import { Seo } from "@/components/seo/Seo";
import { toast } from "@/hooks/use-toast";

type RiskMode = "aggressive" | "smart" | "safe";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  parlay?: any;
}

const RISK_MODES: { id: RiskMode; label: string; emoji: string }[] = [
  { id: "aggressive", label: "Aggressive", emoji: "🔥" },
  { id: "smart", label: "Smart", emoji: "🧠" },
  { id: "safe", label: "Safe", emoji: "🛡️" },
];

export default function LiveAI() {
  const { user, isLoading: authLoading } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "intro",
      role: "assistant",
      content:
        "Yo, what's good? It's Spike. Tap the mic and tell me what you wanna build — parlay, prop, sharp money, whatever. I gotchu.",
    },
  ]);
  const [riskMode, setRiskMode] = useState<RiskMode>("smart");
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [outputVolume, setOutputVolume] = useState(0);
  const [speakingVideoUrl, setSpeakingVideoUrl] = useState<string | null>(null);
  const [partialText, setPartialText] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Init conversation row
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
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const supaUrl = (import.meta as any).env.VITE_SUPABASE_URL;
      const r = await fetch(`${supaUrl}/functions/v1/live-ai-tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);

      // Setup analyser for volume-driven avatar pulse
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
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
            message: userText,
            risk_mode: riskMode,
            conversation_id: conversationId,
            history: messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
          },
        });
        if (error) throw error;
        const reply: string = data?.reply ?? "Hmm, no read on that. Try again.";
        const parlay = data?.parlay ?? null;
        const aiMsg: Msg = { id: crypto.randomUUID(), role: "assistant", content: reply, parlay };
        setMessages((m) => [...m, aiMsg]);
        persistMessage("assistant", reply, parlay);
        // Fire TTS + avatar in parallel
        playTTS(reply);
        requestAvatarVideo(reply);
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
    [riskMode, conversationId, messages, persistMessage, playTTS, requestAvatarVideo],
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
          const { data: sess } = await supabase.auth.getSession();
          const token = sess.session?.access_token;
          const supaUrl = (import.meta as any).env.VITE_SUPABASE_URL;
          const r = await fetch(`${supaUrl}/functions/v1/live-ai-stt-token`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Seo
        title="Live AI — Spike"
        description="Talk live to ParlayFarm's AI bulldog."
        canonical="/live-ai"
      />

      {/* Avatar */}
      <div className="relative w-full aspect-square sm:aspect-video max-h-[55vh] bg-black">
        <DogAvatarVideo
          speakingVideoUrl={speakingVideoUrl}
          isSpeaking={isSpeaking}
          outputVolume={outputVolume}
        />
        <div className="absolute top-3 right-3 flex gap-1">
          {RISK_MODES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRiskMode(r.id)}
              className={`px-2 py-1 rounded-full text-xs font-mono backdrop-blur transition ${
                riskMode === r.id ? "bg-primary text-primary-foreground" : "bg-black/60 text-white"
              }`}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {m.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm">{m.content}</p>
              )}
              {m.parlay && (
                <div className="mt-2">
                  <AIParlayCard parlay={m.parlay} />
                </div>
              )}
            </div>
          </div>
        ))}
        {partialText && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl px-4 py-2 bg-primary/40 text-primary-foreground italic text-sm">
              {partialText}…
            </div>
          </div>
        )}
        {isThinking && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Spike's cookin'…
          </div>
        )}
      </div>

      {/* Mic */}
      <div className="p-6 flex flex-col items-center gap-2 border-t border-border bg-card/30 backdrop-blur">
        <Badge variant="outline" className="text-xs">
          {RISK_MODES.find((r) => r.id === riskMode)?.emoji} {riskMode} mode
        </Badge>
        <button
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
          disabled={isThinking}
          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${
            isRecording
              ? "bg-destructive scale-110 animate-pulse"
              : "bg-primary hover:scale-105"
          } ${isThinking ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {isRecording ? (
            <MicOff className="w-8 h-8 text-white" />
          ) : (
            <Mic className="w-8 h-8 text-primary-foreground" />
          )}
        </button>
        <p className="text-xs text-muted-foreground">
          {isRecording ? "Release to send" : "Hold to talk"}
        </p>
      </div>
    </div>
  );
}