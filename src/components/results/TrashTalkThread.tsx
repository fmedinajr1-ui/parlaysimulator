import { FeedCard } from "../FeedCard";

interface TrashTalkThreadProps {
  trashTalk: string[];
  delay?: number;
}

export function TrashTalkThread({ trashTalk, delay = 0 }: TrashTalkThreadProps) {
  return (
    <FeedCard variant="purple" delay={delay}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-12 h-12 rounded-full gradient-purple flex items-center justify-center text-2xl shrink-0">
          🤖
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-foreground">AI Handicapper</span>
            <span className="text-primary">✓</span>
          </div>
          <span className="text-muted-foreground text-sm">@BookieKillerAI</span>
        </div>
      </div>

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
                <span>💬 Reply</span>
                <span>🔄 Retweet</span>
                <span>❤️ Like</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-muted-foreground text-sm">
        <span>🔥 Thread from your analysis</span>
        <span>Just now</span>
      </div>
    </FeedCard>
  );
}
