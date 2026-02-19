import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { MessageSquare } from 'lucide-react';
import type { SignalType } from '@/hooks/useCustomerWhaleSignals';

interface WhisperPick {
  playerName: string;
  propType: string;
  line: number;
  currentValue: number;
  side?: string;
  gameProgress?: number; // 0-1
}

interface CustomerAIWhisperProps {
  picks: WhisperPick[];
  signals?: Map<string, { signalType: SignalType }>;
}

function generateInsights(picks: WhisperPick[], signals?: Map<string, { signalType: SignalType }>): string[] {
  const insights: string[] = [];

  for (const pick of picks) {
    const pace = pick.currentValue;
    const line = pick.line;
    const progress = pick.gameProgress ?? 0;
    const isOver = pick.side?.toUpperCase() !== 'UNDER';

    // Pacing well above line
    if (isOver && pace > line * 0.6 && progress < 0.6) {
      insights.push(
        `${pick.playerName} is pacing at ${pace} ${pick.propType} — well above the ${line} line`
      );
    }

    // Almost there
    if (isOver && progress > 0.75 && pace >= line * 0.85) {
      const remaining = Math.max(0, Math.ceil(line - pace));
      if (remaining <= 3) {
        insights.push(
          `Almost there — ${pick.playerName} needs just ${remaining} more ${pick.propType}`
        );
      }
    }

    // Pace slowed
    if (isOver && progress > 0.5 && pace < line * 0.4) {
      insights.push(
        `Keep an eye on ${pick.playerName}'s ${pick.propType} — pace has slowed`
      );
    }

    // Under pick cruising
    if (!isOver && pace < line * 0.3 && progress > 0.5) {
      insights.push(
        `${pick.playerName} staying well under the ${line} ${pick.propType} line — looking good`
      );
    }

    // Steam signal
    const signal = signals?.get(pick.playerName.toLowerCase());
    if (signal?.signalType === 'STEAM') {
      insights.push(`Sharp money detected on ${pick.playerName} ${pick.propType}`);
    }
    if (signal?.signalType === 'DIVERGENCE') {
      insights.push(`Whale activity spotted on ${pick.playerName} — line may move`);
    }
  }

  if (insights.length === 0) {
    insights.push('Monitoring all picks — no significant signals yet');
  }

  return insights;
}

export function CustomerAIWhisper({ picks, signals }: CustomerAIWhisperProps) {
  const insights = useMemo(() => generateInsights(picks, signals), [picks, signals]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (insights.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % insights.length);
    }, 30_000);
    return () => clearInterval(interval);
  }, [insights.length]);

  return (
    <Card className="border-border/50 bg-primary/5">
      <CardContent className="p-3 flex items-start gap-2.5">
        <MessageSquare className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-foreground leading-relaxed">
            {insights[currentIndex % insights.length]}
          </p>
          {insights.length > 1 && (
            <div className="flex gap-1 mt-1.5">
              {insights.map((_, i) => (
                <div
                  key={i}
                  className={`w-1 h-1 rounded-full transition-colors ${
                    i === currentIndex % insights.length ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
