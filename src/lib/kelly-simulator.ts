// Monte Carlo Simulation Engine for Kelly Criterion Projections

export interface SimulationParams {
  startingBankroll: number;
  winProbability: number;
  decimalOdds: number;
  kellyMultiplier: number;
  daysToSimulate: number;
  betsPerDay: number;
  iterations: number;
}

export interface DailyDataPoint {
  day: number;
  median: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
}

export interface ProjectionResult {
  kellyMultiplier: number;
  label: string;
  color: string;
  dailyData: DailyDataPoint[];
  finalBankroll: {
    median: number;
    p5: number;
    p25: number;
    p75: number;
    p95: number;
  };
  growthPercent: number;
  riskOfRuin: number;
  maxDrawdown: number;
  probabilityOfProfit: number;
  sharpeRatio: number;
}

export interface WhatIfResults {
  fullKelly: ProjectionResult;
  halfKelly: ProjectionResult;
  quarterKelly: ProjectionResult;
  combinedDailyData: CombinedDailyPoint[];
}

export interface CombinedDailyPoint {
  day: number;
  fullKelly: number;
  halfKelly: number;
  quarterKelly: number;
  fullKellyP25: number;
  fullKellyP75: number;
  halfKellyP25: number;
  halfKellyP75: number;
  quarterKellyP25: number;
  quarterKellyP75: number;
}

// Calculate full Kelly fraction
function calculateKellyFraction(winProb: number, decimalOdds: number): number {
  const b = decimalOdds - 1; // Net odds (profit per unit wagered)
  const q = 1 - winProb;
  const kelly = (b * winProb - q) / b;
  return Math.max(0, kelly);
}

// Run a single simulation path
function runSingleSimulation(params: SimulationParams): { 
  dailyBankrolls: number[]; 
  maxDrawdown: number;
  hitRuin: boolean;
} {
  const { startingBankroll, winProbability, decimalOdds, kellyMultiplier, daysToSimulate, betsPerDay } = params;
  
  let bankroll = startingBankroll;
  let peakBankroll = startingBankroll;
  let maxDrawdown = 0;
  const ruinThreshold = startingBankroll * 0.1; // 10% of starting = ruin
  let hitRuin = false;
  
  const dailyBankrolls: number[] = [startingBankroll];
  const fullKellyFraction = calculateKellyFraction(winProbability, decimalOdds);
  const adjustedKelly = fullKellyFraction * kellyMultiplier;
  
  for (let day = 1; day <= daysToSimulate; day++) {
    for (let bet = 0; bet < betsPerDay; bet++) {
      if (bankroll <= ruinThreshold) {
        hitRuin = true;
        break;
      }
      
      // Calculate bet size based on current bankroll
      const betSize = Math.max(0, bankroll * adjustedKelly);
      
      // Simulate outcome
      const won = Math.random() < winProbability;
      
      if (won) {
        bankroll += betSize * (decimalOdds - 1);
      } else {
        bankroll -= betSize;
      }
      
      // Track peak and drawdown
      if (bankroll > peakBankroll) {
        peakBankroll = bankroll;
      }
      const currentDrawdown = (peakBankroll - bankroll) / peakBankroll;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }
    }
    
    dailyBankrolls.push(Math.max(0, bankroll));
    
    if (hitRuin) {
      // Fill remaining days with ruin value
      for (let remaining = day + 1; remaining <= daysToSimulate; remaining++) {
        dailyBankrolls.push(bankroll);
      }
      break;
    }
  }
  
  return { dailyBankrolls, maxDrawdown, hitRuin };
}

// Calculate percentile from sorted array
function percentile(sortedArr: number[], p: number): number {
  const index = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  
  if (lower === upper) return sortedArr[lower];
  return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
}

// Run Monte Carlo simulation
export function simulateBankrollGrowth(params: SimulationParams): ProjectionResult {
  const { startingBankroll, kellyMultiplier, daysToSimulate, iterations } = params;
  
  // Store all simulation results
  const allDailyBankrolls: number[][] = [];
  const allMaxDrawdowns: number[] = [];
  let ruinCount = 0;
  let profitCount = 0;
  const returns: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const result = runSingleSimulation(params);
    allDailyBankrolls.push(result.dailyBankrolls);
    allMaxDrawdowns.push(result.maxDrawdown);
    if (result.hitRuin) ruinCount++;
    
    const finalBankroll = result.dailyBankrolls[result.dailyBankrolls.length - 1];
    if (finalBankroll > startingBankroll) profitCount++;
    returns.push((finalBankroll - startingBankroll) / startingBankroll);
  }
  
  // Calculate daily percentiles
  const dailyData: DailyDataPoint[] = [];
  for (let day = 0; day <= daysToSimulate; day++) {
    const dayValues = allDailyBankrolls.map(sim => sim[day] || sim[sim.length - 1]).sort((a, b) => a - b);
    dailyData.push({
      day,
      median: percentile(dayValues, 50),
      p5: percentile(dayValues, 5),
      p25: percentile(dayValues, 25),
      p75: percentile(dayValues, 75),
      p95: percentile(dayValues, 95),
    });
  }
  
  // Final bankroll statistics
  const finalValues = allDailyBankrolls.map(sim => sim[sim.length - 1]).sort((a, b) => a - b);
  const finalBankroll = {
    median: percentile(finalValues, 50),
    p5: percentile(finalValues, 5),
    p25: percentile(finalValues, 25),
    p75: percentile(finalValues, 75),
    p95: percentile(finalValues, 95),
  };
  
  // Calculate Sharpe ratio (annualized)
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365 / daysToSimulate) : 0;
  
  // Average max drawdown
  const avgMaxDrawdown = allMaxDrawdowns.reduce((a, b) => a + b, 0) / allMaxDrawdowns.length;
  
  // Get label and color based on multiplier
  const { label, color } = getMultiplierMeta(kellyMultiplier);
  
  return {
    kellyMultiplier,
    label,
    color,
    dailyData,
    finalBankroll,
    growthPercent: ((finalBankroll.median - startingBankroll) / startingBankroll) * 100,
    riskOfRuin: (ruinCount / iterations) * 100,
    maxDrawdown: avgMaxDrawdown * 100,
    probabilityOfProfit: (profitCount / iterations) * 100,
    sharpeRatio,
  };
}

function getMultiplierMeta(multiplier: number): { label: string; color: string } {
  if (multiplier >= 0.9) return { label: 'Full Kelly', color: 'hsl(var(--chart-2))' };
  if (multiplier >= 0.4) return { label: 'Half Kelly', color: 'hsl(var(--primary))' };
  return { label: 'Quarter Kelly', color: 'hsl(var(--muted-foreground))' };
}

// Run What-If comparison for all three Kelly multipliers
export function runWhatIfComparison(
  startingBankroll: number,
  winProbability: number,
  decimalOdds: number,
  daysToSimulate: number,
  betsPerDay: number = 3,
  iterations: number = 1000
): WhatIfResults {
  const baseParams = {
    startingBankroll,
    winProbability,
    decimalOdds,
    daysToSimulate,
    betsPerDay,
    iterations,
  };
  
  const fullKelly = simulateBankrollGrowth({ ...baseParams, kellyMultiplier: 1.0 });
  const halfKelly = simulateBankrollGrowth({ ...baseParams, kellyMultiplier: 0.5 });
  const quarterKelly = simulateBankrollGrowth({ ...baseParams, kellyMultiplier: 0.25 });
  
  // Combine daily data for chart
  const combinedDailyData: CombinedDailyPoint[] = fullKelly.dailyData.map((_, i) => ({
    day: i,
    fullKelly: fullKelly.dailyData[i].median,
    halfKelly: halfKelly.dailyData[i].median,
    quarterKelly: quarterKelly.dailyData[i].median,
    fullKellyP25: fullKelly.dailyData[i].p25,
    fullKellyP75: fullKelly.dailyData[i].p75,
    halfKellyP25: halfKelly.dailyData[i].p25,
    halfKellyP75: halfKelly.dailyData[i].p75,
    quarterKellyP25: quarterKelly.dailyData[i].p25,
    quarterKellyP75: quarterKelly.dailyData[i].p75,
  }));
  
  return {
    fullKelly,
    halfKelly,
    quarterKelly,
    combinedDailyData,
  };
}
