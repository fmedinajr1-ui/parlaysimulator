import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, DollarSign } from "lucide-react";

interface BookmakerOdds {
  bookmaker: string;
  price: number;
  point?: number;
}

interface LineShoppingCalculatorProps {
  bookmakerOdds: BookmakerOdds[];
  outcomeName: string;
}

const calculateProfit = (stake: number, americanOdds: number): number => {
  if (americanOdds > 0) {
    return (stake * americanOdds) / 100;
  } else {
    return (stake * 100) / Math.abs(americanOdds);
  }
};

const calculatePayout = (stake: number, americanOdds: number): number => {
  return stake + calculateProfit(stake, americanOdds);
};

export function LineShoppingCalculator({ bookmakerOdds, outcomeName }: LineShoppingCalculatorProps) {
  const [betAmount, setBetAmount] = useState<string>("100");

  const stake = parseFloat(betAmount) || 0;

  const calculations = bookmakerOdds
    .map((book) => ({
      bookmaker: book.bookmaker,
      price: book.price,
      point: book.point,
      profit: calculateProfit(stake, book.price),
      payout: calculatePayout(stake, book.price),
    }))
    .sort((a, b) => b.profit - a.profit);

  const bestProfit = calculations[0]?.profit || 0;
  const worstProfit = calculations[calculations.length - 1]?.profit || 0;
  const profitDifference = bestProfit - worstProfit;

  if (bookmakerOdds.length === 0) {
    return null;
  }

  return (
    <Card className="p-6 bg-card border-border">
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">
            Line Shopping Calculator
          </h3>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{outcomeName}</span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bet-amount" className="text-sm font-medium text-foreground">
            Bet Amount ($)
          </Label>
          <Input
            id="bet-amount"
            type="number"
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
            min="0"
            step="10"
            className="max-w-xs bg-background border-border text-foreground"
          />
        </div>

        {stake > 0 && (
          <>
            <div className="grid gap-3 mt-6">
              {calculations.map((calc, index) => {
                const isBest = index === 0;
                const profitDiff = calc.profit - worstProfit;
                
                return (
                  <div
                    key={calc.bookmaker}
                    className={`p-4 rounded-lg border ${
                      isBest
                        ? "bg-primary/10 border-primary"
                        : "bg-muted/30 border-border"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-semibold text-foreground flex items-center gap-2">
                          {calc.bookmaker}
                          {isBest && (
                            <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" />
                              Best Value
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {calc.price > 0 ? "+" : ""}
                          {calc.price}
                          {calc.point && ` (${calc.point > 0 ? "+" : ""}${calc.point})`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-foreground">
                          ${calc.profit.toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          profit
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex justify-between text-sm mt-2 pt-2 border-t border-border/50">
                      <span className="text-muted-foreground">Total Payout:</span>
                      <span className="font-medium text-foreground">${calc.payout.toFixed(2)}</span>
                    </div>
                    
                    {!isBest && profitDiff > 0 && (
                      <div className="text-xs text-destructive mt-1">
                        Losing ${profitDiff.toFixed(2)} vs best line
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {profitDifference > 0 && (
              <div className="mt-4 p-4 bg-primary/10 border border-primary rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-foreground">Line Shopping Advantage</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  By shopping for the best line, you gain an extra{" "}
                  <span className="font-bold text-primary">
                    ${profitDifference.toFixed(2)}
                  </span>{" "}
                  in profit compared to the worst option.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  That's a{" "}
                  <span className="font-semibold text-foreground">
                    {((profitDifference / worstProfit) * 100).toFixed(1)}%
                  </span>{" "}
                  increase in profit!
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
