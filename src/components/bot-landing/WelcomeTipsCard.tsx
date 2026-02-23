import { useState } from "react";
import { Lightbulb, X, Send } from "lucide-react";

interface WelcomeTipsCardProps {
  forceShow?: boolean;
}

export function WelcomeTipsCard({ forceShow = false }: WelcomeTipsCardProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (forceShow) return false;
    return localStorage.getItem("bot-welcome-dismissed") === "true";
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem("bot-welcome-dismissed", "true");
    setDismissed(true);
  };

  return (
    <div className="px-4 py-3">
      <div className="relative rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-4">
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss tips"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Lightbulb className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground text-sm">Welcome Tips</h3>
        </div>

        <ul className="space-y-2 text-sm text-muted-foreground pr-4">
          <li className="flex gap-2">
            <span className="text-primary shrink-0">•</span>
            Place <strong className="text-foreground">ALL parlays</strong> provided each day — the system is designed around volume
          </li>
          <li className="flex gap-2">
            <span className="text-primary shrink-0">•</span>
            <span>
              Join the{" "}
              <a
                href="https://t.me/parlayiqbot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline inline-flex items-center gap-1"
              >
                Telegram bot <Send className="w-3 h-3 inline" />
              </a>{" "}
              for real-time alerts
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary shrink-0">•</span>
            Check the Performance Calendar daily to track results
          </li>
          <li className="flex gap-2">
            <span className="text-primary shrink-0">•</span>
            Parlays are generated fresh each morning — don't miss a day
          </li>
        </ul>

        <button
          onClick={handleDismiss}
          className="mt-3 w-full py-2 rounded-xl bg-primary/15 text-primary text-sm font-medium hover:bg-primary/25 transition-colors"
        >
          Got it 👍
        </button>
      </div>
    </div>
  );
}
