import { FeedCard } from "../FeedCard";
import { TrendingUp, TrendingDown, DollarSign, Target } from "lucide-react";

interface BankrollCardProps {
  stake: number;
  potentialPayout: number;
  expectedValue: number;
  probability: number;
  delay?: number;
}

export function BankrollCard({ stake, potentialPayout, expectedValue, probability, delay = 0 }: BankrollCardProps) {
  const profit = potentialPayout - stake;
  const isPositiveEV = expectedValue > 0;

  return (
    <FeedCard delay={delay}>
      <p className="text-sm text-muted-foreground uppercase tracking-wider mb-4">
        💰 Bankroll Breakdown
      </p>
      
      <div className="grid grid-cols-2 gap-4">
        {/* Stake */}
        <div className="text-center p-4 rounded-xl bg-muted/50">
          <DollarSign className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-2xl font-bold text-foreground">${stake.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground uppercase">Your Stake</p>
        </div>

        {/* Potential Payout */}
        <div className="text-center p-4 rounded-xl bg-neon-green/10 border border-neon-green/20">
          <Target className="w-6 h-6 mx-auto mb-2 text-neon-green" />
          <p className="text-2xl font-bold text-neon-green">${potentialPayout.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground uppercase">Potential Win</p>
        </div>

        {/* Profit */}
        <div className="text-center p-4 rounded-xl bg-muted/50">
          <TrendingUp className="w-6 h-6 mx-auto mb-2 text-neon-cyan" />
          <p className="text-2xl font-bold text-neon-cyan">${profit.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground uppercase">Profit if Win</p>
        </div>

        {/* Expected Value */}
        <div className={`text-center p-4 rounded-xl ${isPositiveEV ? 'bg-neon-green/10 border border-neon-green/20' : 'bg-neon-red/10 border border-neon-red/20'}`}>
          {isPositiveEV ? (
            <TrendingUp className="w-6 h-6 mx-auto mb-2 text-neon-green" />
          ) : (
            <TrendingDown className="w-6 h-6 mx-auto mb-2 text-neon-red" />
          )}
          <p className={`text-2xl font-bold ${isPositiveEV ? 'text-neon-green' : 'text-neon-red'}`}>
            {isPositiveEV ? '+' : ''}{expectedValue.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground uppercase">Expected Value</p>
        </div>
      </div>

      {/* EV Explanation */}
      <div className="mt-4 p-3 rounded-xl bg-muted/30 text-center">
        <p className="text-sm text-muted-foreground">
          {isPositiveEV ? (
            <span>✅ This bet has +EV! Statistically profitable long-term.</span>
          ) : (
            <span>📉 This bet has -EV. The house edge is eating your edge.</span>
          )}
        </p>
      </div>
    </FeedCard>
  );
}
