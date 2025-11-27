import { FeedCard } from "../FeedCard";
import { Loader2, Sparkles } from "lucide-react";

interface TrashTalkThreadProps {
  trashTalk: string[];
  isLoading?: boolean;
  isAiGenerated?: boolean;
  delay?: number;
}

export function TrashTalkThread({ trashTalk, isLoading = false, isAiGenerated = false, delay = 0 }: TrashTalkThreadProps) {
  return (
    <FeedCard variant="purple" delay={delay}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-12 h-12 rounded-full gradient-purple flex items-center justify-center text-2xl shrink-0">
          🤖
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-foreground">AI Handicapper</span>
            <span className="text-primary">✓</span>
            {isAiGenerated && (
              <span className="flex items-center gap-1 text-xs text-neon-purple bg-neon-purple/10 px-2 py-0.5 rounded-full">
                <Sparkles className="w-3 h-3" />
                AI
              </span>
            )}
          </div>
          <span className="text-muted-foreground text-sm">@BookieKillerAI</span>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-neon-purple mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">AI is crafting your roast...</p>
          <p className="text-muted-foreground/60 text-xs mt-1">This is gonna hurt 💀</p>
        </div>
      ) : (
        <div className="space-y-4 pl-2 border-l-2 border-neon-purple/30 ml-6">
          {trashTalk.map((line, idx) => (
            <div 
              key={idx} 
              className="pl-4 slide-up"
              style={{ animationDelay: `${delay + (idx * 150)}ms` }}
            >
              <p className="text-foreground/90 text-lg leading-relaxed">
                {line}
              </p>
              {idx < trashTalk.length - 1 && (
                <div className="flex items-center gap-4 mt-2 text-muted-foreground text-sm">
                  <span className="hover:text-foreground cursor-pointer transition-colors">💬 Reply</span>
                  <span className="hover:text-foreground cursor-pointer transition-colors">🔄 Retweet</span>
                  <span className="hover:text-neon-pink cursor-pointer transition-colors">❤️ Like</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-muted-foreground text-sm">
        <span className="flex items-center gap-1">
          🔥 {isAiGenerated ? "AI-generated roast thread" : "Thread from your analysis"}
        </span>
        <span>Just now</span>
      </div>
    </FeedCard>
  );
}
