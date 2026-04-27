import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Send, Copy, Check, ArrowRight, Camera, Sparkles, MessageSquare } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BOT_URL = "https://t.me/parlayiqbot";
const BOT_HANDLE = "@parlayiqbot";

interface TelegramOnboardingProps {
  email: string;
  onContinue: () => void;
}

export function TelegramOnboarding({ email, onContinue }: TelegramOnboardingProps) {
  const [copied, setCopied] = useState(false);
  const linkCommand = `/link ${email}`;

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(linkCommand);
      setCopied(true);
      toast({ title: "Copied", description: "Paste it in Telegram after opening the bot." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Long-press to copy manually.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center">
          <Send className="w-7 h-7 text-primary" />
        </div>
        <h1 className="font-display text-2xl text-foreground">Analyze slips from Telegram</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Snap any sportsbook screenshot, send it to our bot, and get an 8-engine breakdown — keep, swap, or drop each leg.
        </p>
      </div>

      <Card className="p-4 space-y-4 border-primary/20">
        <Step
          n={1}
          icon={<MessageSquare className="w-4 h-4" />}
          title="Open the bot"
          body={
            <a
              href={BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
            >
              {BOT_HANDLE}
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          }
        />
        <Step
          n={2}
          icon={<Copy className="w-4 h-4" />}
          title="Send this command to link your account"
          body={
            <button
              onClick={copyCommand}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-muted/60 hover:bg-muted text-left font-mono text-xs"
            >
              <span className="truncate">{linkCommand}</span>
              {copied ? <Check className="w-4 h-4 text-primary shrink-0" /> : <Copy className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>
          }
        />
        <Step
          n={3}
          icon={<Camera className="w-4 h-4" />}
          title="Send a screenshot of any prop page"
          body={
            <p className="text-xs text-muted-foreground">
              FanDuel, DraftKings, Hard Rock, PrizePicks, or Underdog. Set the book with{" "}
              <code className="font-mono text-foreground/80">/book hardrock</code> if needed.
            </p>
          }
        />
        <Step
          n={4}
          icon={<Sparkles className="w-4 h-4" />}
          title="Build a vetted parlay"
          body={
            <p className="text-xs text-muted-foreground">
              Type <code className="font-mono text-foreground/80">/parlay 3</code> and we'll cross-reference every leg
              against PVS, Median Lock, Sharp Signals, Trap Probability, Hit Rates, Juice and Injuries.
            </p>
          }
        />
      </Card>

      <div className="flex flex-col gap-2">
        <Button asChild size="lg" className="w-full">
          <a href={BOT_URL} target="_blank" rel="noopener noreferrer">
            <Send className="w-4 h-4 mr-2" />
            Open {BOT_HANDLE}
          </a>
        </Button>
        <Button variant="ghost" size="sm" onClick={onContinue} className="w-full">
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function Step({ n, icon, title, body }: { n: number; icon: React.ReactNode; title: string; body: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
        {n}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon}
          <span>{title}</span>
        </div>
        <div>{body}</div>
      </div>
    </div>
  );
}