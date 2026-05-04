import { useEffect, useRef, useState } from "react";
import idleVideoAsset from "@/assets/parlayfarm-dog-idle.mp4.asset.json";
import dogPortrait from "@/assets/parlayfarm-dog-avatar.png";

interface Props {
  speakingVideoUrl?: string | null;
  isSpeaking?: boolean;
  outputVolume?: number; // 0-1, used when no HeyGen video available
  className?: string;
}

export function DogAvatarVideo({ speakingVideoUrl, isSpeaking = false, outputVolume = 0, className }: Props) {
  const idleRef = useRef<HTMLVideoElement | null>(null);
  const speakRef = useRef<HTMLVideoElement | null>(null);
  const [speakReady, setSpeakReady] = useState(false);
  const [idleReady, setIdleReady] = useState(false);
  const [idleFailed, setIdleFailed] = useState(false);

  useEffect(() => {
    setSpeakReady(false);
  }, [speakingVideoUrl]);

  // Pulse intensity for fallback
  const pulse = isSpeaking ? Math.max(0.35, Math.min(1, outputVolume * 2.5)) : 0;
  const breath = 1 + (isSpeaking ? pulse * 0.06 : 0.015);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-gradient-to-b from-zinc-900 via-black to-zinc-950 ${className ?? ""}`}>
      {/* Always-on portrait base layer */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-transform duration-300"
        style={{
          transform: `scale(${breath})`,
        }}
      >
        {/* Glow halo */}
        <div
          className="absolute inset-0 transition-opacity duration-200"
          style={{
            background: `radial-gradient(circle at 50% 45%, hsl(var(--primary) / ${0.25 + pulse * 0.45}) 0%, transparent 55%)`,
          }}
        />
        <img
          src={dogPortrait}
          alt="Spike the ParlayFarm bulldog"
          className="relative w-full h-full object-cover select-none"
          draggable={false}
        />
        {/* Speaking glow ring */}
        {isSpeaking && (
          <div
            className="absolute inset-4 rounded-full pointer-events-none"
            style={{
              boxShadow: `0 0 ${20 + pulse * 80}px ${pulse * 12}px hsl(var(--primary) / ${0.3 + pulse * 0.5})`,
            }}
          />
        )}
      </div>

      {/* Idle loop — fades in only if it actually loads */}
      {!idleFailed && (
        <video
          ref={idleRef}
          src={idleVideoAsset.url}
          autoPlay
          loop
          muted
          playsInline
          onCanPlay={() => setIdleReady(true)}
          onError={() => setIdleFailed(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
            idleReady ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* Talking-dog clip overlay */}
      {speakingVideoUrl && (
        <video
          ref={speakRef}
          src={speakingVideoUrl}
          autoPlay playsInline
          onCanPlay={() => setSpeakReady(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${speakReady && isSpeaking ? "opacity-100" : "opacity-0"}`}
        />
      )}

      {/* LIVE pill */}
      <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 backdrop-blur text-xs text-white font-mono">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        SPIKE
      </div>
    </div>
  );
}