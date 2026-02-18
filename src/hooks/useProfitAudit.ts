import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, format, getDay, parseISO } from 'date-fns';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const TIER_LABELS: Record<string, string> = {
  execution: 'Execution',
  validation: 'Validation',
  exploration: 'Exploration',
};

export interface DailyTierRow {
  parlay_date: string;
  tier: string;
  tierLabel: string;
  parlayCount: number;
  wins: number;
  losses: number;
  totalStaked: number;
  grossWon: number;
  netProfit: number;
  roiPct: number;
}

export interface TierSummary {
  tier: string;
  tierLabel: string;
  parlayCount: number;
  wins: number;
  losses: number;
  totalStaked: number;
  netProfit: number;
  roiPct: number;
}

export interface DowSummary {
  dow: number;
  dowLabel: string;
  dowFull: string;
  parlayCount: number;
  totalStaked: number;
  netProfit: number;
  roiPct: number;
}

export interface ProfitAuditResult {
  dailyTierRows: DailyTierRow[];
  tierSummary: TierSummary[];
  dowSummary: DowSummary[];
  bestTier: TierSummary | null;
  bestDow: DowSummary | null;
  totalNetProfit: number;
  totalStaked: number;
  totalGrossWon: number;
  overallROI: number;
  dateRange: { from: string; to: string };
  isLoading: boolean;
  error: Error | null;
}

async function fetchProfitAudit(): Promise<Omit<ProfitAuditResult, 'isLoading' | 'error'>> {
  const today = new Date();
  const sevenDaysAgo = subDays(today, 6);
  const fromDate = format(sevenDaysAgo, 'yyyy-MM-dd');
  const toDate = format(today, 'yyyy-MM-dd');

  const { data, error } = await supabase
    .from('bot_daily_parlays')
    .select('parlay_date, tier, outcome, simulated_stake, profit_loss')
    .gte('parlay_date', fromDate)
    .lte('parlay_date', toDate)
    .in('outcome', ['won', 'lost', 'push'])
    .order('parlay_date', { ascending: false });

  if (error) throw error;

  const rows = data || [];

  // Group by (parlay_date × tier)
  const groupMap = new Map<string, {
    parlay_date: string;
    tier: string;
    wins: number;
    losses: number;
    parlayCount: number;
    totalStaked: number;
    grossWon: number;
    netProfit: number;
  }>();

  // Tier-level aggregation
  const tierMap = new Map<string, {
    wins: number; losses: number; parlayCount: number;
    totalStaked: number; netProfit: number;
  }>();

  // Day-of-week aggregation (keyed by dow index)
  const dowMap = new Map<number, {
    wins: number; losses: number; parlayCount: number;
    totalStaked: number; netProfit: number;
  }>();

  for (const row of rows) {
    const date = row.parlay_date;
    const tier = row.tier || 'unknown';
    const outcome = row.outcome || '';
    const stake = row.simulated_stake || 0;
    const pl = row.profit_loss || 0;

    const isWon = outcome === 'won';
    const isLost = outcome === 'lost';
    const grossWon = isWon ? stake + pl : outcome === 'push' ? stake : 0;

    // Daily × Tier group
    const key = `${date}|${tier}`;
    const existing = groupMap.get(key) || {
      parlay_date: date, tier,
      wins: 0, losses: 0, parlayCount: 0,
      totalStaked: 0, grossWon: 0, netProfit: 0,
    };
    existing.parlayCount += 1;
    existing.wins += isWon ? 1 : 0;
    existing.losses += isLost ? 1 : 0;
    existing.totalStaked += stake;
    existing.grossWon += grossWon;
    existing.netProfit += pl;
    groupMap.set(key, existing);

    // Tier-level
    const te = tierMap.get(tier) || { wins: 0, losses: 0, parlayCount: 0, totalStaked: 0, netProfit: 0 };
    te.parlayCount += 1;
    te.wins += isWon ? 1 : 0;
    te.losses += isLost ? 1 : 0;
    te.totalStaked += stake;
    te.netProfit += pl;
    tierMap.set(tier, te);

    // Day-of-week level
    const dow = getDay(parseISO(date));
    const de = dowMap.get(dow) || { wins: 0, losses: 0, parlayCount: 0, totalStaked: 0, netProfit: 0 };
    de.parlayCount += 1;
    de.wins += isWon ? 1 : 0;
    de.losses += isLost ? 1 : 0;
    de.totalStaked += stake;
    de.netProfit += pl;
    dowMap.set(dow, de);
  }

  // Build dailyTierRows sorted newest-first
  const dailyTierRows: DailyTierRow[] = Array.from(groupMap.values()).map(g => ({
    parlay_date: g.parlay_date,
    tier: g.tier,
    tierLabel: TIER_LABELS[g.tier] || g.tier,
    parlayCount: g.parlayCount,
    wins: g.wins,
    losses: g.losses,
    totalStaked: g.totalStaked,
    grossWon: g.grossWon,
    netProfit: g.netProfit,
    roiPct: g.totalStaked > 0 ? (g.netProfit / g.totalStaked) * 100 : 0,
  })).sort((a, b) => b.parlay_date.localeCompare(a.parlay_date));

  // Tier summary sorted by ROI descending
  const tierSummary: TierSummary[] = Array.from(tierMap.entries()).map(([tier, t]) => ({
    tier,
    tierLabel: TIER_LABELS[tier] || tier,
    parlayCount: t.parlayCount,
    wins: t.wins,
    losses: t.losses,
    totalStaked: t.totalStaked,
    netProfit: t.netProfit,
    roiPct: t.totalStaked > 0 ? (t.netProfit / t.totalStaked) * 100 : 0,
  })).sort((a, b) => b.roiPct - a.roiPct);

  // Day-of-week summary sorted by ROI descending
  const dowSummary: DowSummary[] = Array.from(dowMap.entries()).map(([dow, d]) => ({
    dow,
    dowLabel: DOW_LABELS[dow],
    dowFull: DOW_FULL[dow],
    parlayCount: d.parlayCount,
    totalStaked: d.totalStaked,
    netProfit: d.netProfit,
    roiPct: d.totalStaked > 0 ? (d.netProfit / d.totalStaked) * 100 : 0,
  })).sort((a, b) => b.roiPct - a.roiPct);

  const totalNetProfit = rows.reduce((s, r) => s + (r.profit_loss || 0), 0);
  const totalStaked = rows.reduce((s, r) => s + (r.simulated_stake || 0), 0);
  const totalGrossWon = rows
    .filter(r => r.outcome === 'won')
    .reduce((s, r) => s + (r.simulated_stake || 0) + (r.profit_loss || 0), 0);
  const overallROI = totalStaked > 0 ? (totalNetProfit / totalStaked) * 100 : 0;

  return {
    dailyTierRows,
    tierSummary,
    dowSummary,
    bestTier: tierSummary[0] ?? null,
    bestDow: dowSummary[0] ?? null,
    totalNetProfit,
    totalStaked,
    totalGrossWon,
    overallROI,
    dateRange: { from: fromDate, to: toDate },
  };
}

export function useProfitAudit(): ProfitAuditResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['profit-audit-7d'],
    queryFn: fetchProfitAudit,
    staleTime: 5 * 60 * 1000,
  });

  return {
    dailyTierRows: data?.dailyTierRows ?? [],
    tierSummary: data?.tierSummary ?? [],
    dowSummary: data?.dowSummary ?? [],
    bestTier: data?.bestTier ?? null,
    bestDow: data?.bestDow ?? null,
    totalNetProfit: data?.totalNetProfit ?? 0,
    totalStaked: data?.totalStaked ?? 0,
    totalGrossWon: data?.totalGrossWon ?? 0,
    overallROI: data?.overallROI ?? 0,
    dateRange: data?.dateRange ?? { from: '', to: '' },
    isLoading,
    error: error as Error | null,
  };
}
