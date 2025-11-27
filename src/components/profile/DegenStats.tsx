import { FeedCard } from '@/components/FeedCard';
import { Trophy, TrendingUp, TrendingDown, DollarSign, Target } from 'lucide-react';

interface DegenStatsProps {
  totalWins: number;
  totalLosses: number;
  totalStaked: number;
  totalPayout: number;
  lifetimeDegenScore: number;
}

export const DegenStats = ({
  totalWins,
  totalLosses,
  totalStaked,
  totalPayout,
  lifetimeDegenScore
}: DegenStatsProps) => {
  const totalBets = totalWins + totalLosses;
  const winRate = totalBets > 0 ? ((totalWins / totalBets) * 100).toFixed(1) : '0.0';
  const profit = totalPayout - totalStaked;
  const isProfitable = profit >= 0;

  const getDegenTier = (score: number) => {
    if (score >= 80) return { label: 'ABSOLUTE DEGEN', emoji: '💀', color: 'text-neon-red' };
    if (score >= 60) return { label: 'CERTIFIED DEGEN', emoji: '🎟️', color: 'text-neon-orange' };
    if (score >= 40) return { label: 'SWEATY BETTOR', emoji: '😰', color: 'text-neon-yellow' };
    if (score >= 20) return { label: 'CASUAL GAMBLER', emoji: '🤷', color: 'text-neon-purple' };
    return { label: 'SHARP(ISH)', emoji: '✅', color: 'text-neon-green' };
  };

  const tier = getDegenTier(lifetimeDegenScore);

  return (
    <FeedCard>
      <h3 className="font-display text-lg text-foreground mb-4">DEGEN STATS</h3>

      {/* Degen Score */}
      <div className="text-center mb-6 p-4 rounded-xl bg-muted">
        <p className="text-5xl mb-2">{tier.emoji}</p>
        <p className={`font-display text-xl ${tier.color}`}>{tier.label}</p>
        <p className="text-sm text-muted-foreground mt-1">
          Degen Score: {lifetimeDegenScore.toFixed(0)}/100
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Win/Loss */}
        <div className="p-3 rounded-lg bg-muted">
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="w-4 h-4 text-neon-yellow" />
            <span className="text-xs text-muted-foreground">RECORD</span>
          </div>
          <p className="font-display text-xl text-foreground">
            {totalWins}W - {totalLosses}L
          </p>
          <p className="text-xs text-muted-foreground">{winRate}% win rate</p>
        </div>

        {/* Total Staked */}
        <div className="p-3 rounded-lg bg-muted">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-neon-cyan" />
            <span className="text-xs text-muted-foreground">STAKED</span>
          </div>
          <p className="font-display text-xl text-foreground">
            ${totalStaked.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground">lifetime total</p>
        </div>

        {/* Profit/Loss */}
        <div className="p-3 rounded-lg bg-muted">
          <div className="flex items-center gap-2 mb-1">
            {isProfitable ? (
              <TrendingUp className="w-4 h-4 text-neon-green" />
            ) : (
              <TrendingDown className="w-4 h-4 text-neon-red" />
            )}
            <span className="text-xs text-muted-foreground">P/L</span>
          </div>
          <p className={`font-display text-xl ${isProfitable ? 'text-neon-green' : 'text-neon-red'}`}>
            {isProfitable ? '+' : ''}{profit.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground">total {isProfitable ? 'profit' : 'loss'}</p>
        </div>

        {/* Total Won */}
        <div className="p-3 rounded-lg bg-muted">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-neon-purple" />
            <span className="text-xs text-muted-foreground">WON</span>
          </div>
          <p className="font-display text-xl text-foreground">
            ${totalPayout.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground">total payouts</p>
        </div>
      </div>
    </FeedCard>
  );
};
