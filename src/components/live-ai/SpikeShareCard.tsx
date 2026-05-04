import { useEffect, useState } from "react";
import { Copy, Check, Share2, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

interface Props {
  /** Optional override URL (e.g. when the agent returns share_link inline) */
  url?: string;
  variant?: "inline" | "banner";
}

/**
 * Small card surfacing the user's permanent /spike/:token URL so they can
 * bookmark or text it to themselves and always come back to Spike.
 */
export function SpikeShareCard({ url: urlProp, variant = "banner" }: Props) {
  const { user } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (urlProp || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_my_spike_token");
        if (!cancelled && !error && typeof data === "string") setToken(data);
      } catch (e) {
        console.warn("[SpikeShareCard] token fetch failed", e);
      }
    })();
    return () => { cancelled = true; };
  }, [user, urlProp]);

  const url = urlProp ?? (token ? `${window.location.origin}/spike/${token}` : null);
  if (!url) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Link copied", description: "Bookmark it or text it to yourself." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy", variant: "destructive" });
    }
  };

  const shareNative = async () => {
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: "Spike — your AI sportsbook bulldog", url });
        return;
      } catch { /* canceled */ }
    }
    copy();
  };

  const sms = `sms:?body=${encodeURIComponent(`Spike's always here: ${url}`)}`;

  return (
    <div
      className={
        variant === "inline"
          ? "rounded-xl border border-primary/40 bg-zinc-900/85 backdrop-blur p-3 flex flex-col gap-2 shadow-lg"
          : "rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 to-zinc-900/80 backdrop-blur-md p-3 flex flex-col gap-2 shadow-lg"
      }
    >
      <div className="flex items-center gap-2 text-white text-xs font-semibold">
        <Share2 className="w-3.5 h-3.5 text-primary" />
        Your personal Spike link — bookmark it
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11px] text-white/80 truncate bg-black/40 rounded px-2 py-1.5 font-mono">
          {url}
        </code>
        <button
          onClick={copy}
          className="shrink-0 h-7 w-7 rounded-md bg-primary/90 hover:bg-primary text-primary-foreground flex items-center justify-center"
          aria-label="Copy link"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="flex gap-2">
        <a
          href={sms}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold py-1.5"
        >
          <MessageCircle className="w-3.5 h-3.5" /> Text to me
        </a>
        <button
          onClick={shareNative}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold py-1.5"
        >
          <Share2 className="w-3.5 h-3.5" /> Share
        </button>
      </div>
    </div>
  );
}