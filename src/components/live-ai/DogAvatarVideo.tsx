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

  useEffect(() => {
    setSpeakReady(false);
  }, [speakingVideoUrl]);

  // Pulse intensity for fallback
  const pulse = isSpeaking ? Math.max(0.3, Math.min(1, outputVolume * 2)) : 0;

  return (
    <div className={`relative w-full h-full overflow-hidden bg-black ${className ?? ""}`}>
      {/* Idle loop — always present */}
      <video
        ref={idleRef}
        src={idleVideoAsset.url}
        autoPlay loop muted playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

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

      {/* Fallback overlay when speaking but no HeyGen — animated portrait */}
      {!speakingVideoUrl && isSpeaking && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at center, hsl(var(--primary) / ${0.15 + pulse * 0.35}) 0%, transparent 60%)`,
          }}
        >
          <img
            src={dogPortrait}
            alt=""
            className="w-1/2 rounded-full opacity-0"
            style={{ transform: `scale(${1 + pulse * 0.05})` }}
          />
        </div>
      )}

      {/* LIVE pill */}
      <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 backdrop-blur text-xs text-white font-mono">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        SPIKE
      </div>
    </div>
  );
}