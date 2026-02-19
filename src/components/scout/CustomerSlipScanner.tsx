import React, { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, Upload, Loader2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { calculateCHESSEV, type CHESSInputs } from '@/lib/chess-ev-calculator';
import { calculateKelly, americanToDecimal } from '@/lib/kelly-calculator';
import { useRiskMode } from '@/contexts/RiskModeContext';
import { cn } from '@/lib/utils';

interface ExtractedLeg {
  playerName: string;
  propType: string;
  line: number;
  side: string;
  odds?: number;
}

interface ScoredLeg extends ExtractedLeg {
  edgeScore: number;
  kellyPercent: number;
  verdict: 'Strong Edge' | 'Thin Edge' | 'No Edge';
}

export function CustomerSlipScanner() {
  const { kellyMultiplier } = useRiskMode();
  const [isScanning, setIsScanning] = useState(false);
  const [scoredLegs, setScoredLegs] = useState<ScoredLeg[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setIsScanning(true);
    setScoredLegs([]);

    // Show preview
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    try {
      // Convert to base64
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });

      // Call extract-parlay edge function
      const { data, error } = await supabase.functions.invoke('extract-parlay', {
        body: { image: base64 },
      });

      if (error) throw error;

      const legs: ExtractedLeg[] = data?.legs ?? [];

      // Score each leg
      const scored: ScoredLeg[] = legs.map((leg) => {
        // Run CHESS EV with conservative defaults (no live injury data in scanner context)
        const chessInputs: CHESSInputs = {
          injuryValue: 0.1,
          offensiveEdge: 0.5,
          defensivePressure: 0.4,
          lineValue: 50,
          publicInfluence: 0.3,
          trapTendency: 0.2,
          marketConsensus: 5,
        };
        const chessResult = calculateCHESSEV(chessInputs);

        // Run Kelly
        const odds = leg.odds ?? -110;
        const decimalOdds = americanToDecimal(odds);
        const kellyResult = calculateKelly({
          winProbability: Math.min(0.65, Math.max(0.35, chessResult.normalized / 100)),
          decimalOdds,
          bankroll: 100,
          kellyMultiplier,
          maxBetPercent: 0.05,
        });

        const edgeScore = Math.round(chessResult.normalized);
        const kellyPercent = Math.round(kellyResult.adjustedKellyFraction * 1000) / 10;

        let verdict: ScoredLeg['verdict'] = 'No Edge';
        if (edgeScore >= 65) verdict = 'Strong Edge';
        else if (edgeScore >= 40) verdict = 'Thin Edge';

        return { ...leg, edgeScore, kellyPercent, verdict };
      });

      setScoredLegs(scored);
    } catch (err) {
      console.error('Slip scan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const clear = () => {
    setScoredLegs([]);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const verdictColor = (v: ScoredLeg['verdict']) => {
    if (v === 'Strong Edge') return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    if (v === 'Thin Edge') return 'text-chart-3 border-chart-3/30 bg-chart-3/10';
    return 'text-muted-foreground border-border bg-muted/30';
  };

  return (
    <Card className="border-border/50">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Slip Scanner</span>
          </div>
          {scoredLegs.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clear} className="h-6 px-2 text-xs">
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          )}
        </div>

        {/* Upload area */}
        {scoredLegs.length === 0 && !isScanning && (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border/60 rounded-lg p-6 cursor-pointer hover:border-primary/40 transition-colors">
            <Upload className="w-8 h-8 text-muted-foreground/50" />
            <span className="text-xs text-muted-foreground">Upload betting slip screenshot</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleInputChange}
            />
          </label>
        )}

        {/* Scanning state */}
        {isScanning && (
          <div className="flex flex-col items-center gap-3 py-6">
            {previewUrl && (
              <img src={previewUrl} alt="Slip" className="w-32 h-auto rounded-lg border border-border/50 opacity-60" />
            )}
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Scanning & scoring...</span>
            </div>
          </div>
        )}

        {/* Results */}
        {scoredLegs.length > 0 && (
          <div className="space-y-2">
            {scoredLegs.map((leg, i) => (
              <div key={i} className="rounded-lg border border-border/40 bg-card/50 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold truncate">{leg.playerName}</span>
                  <Badge variant="outline" className={cn('text-[10px] px-2 py-0.5', verdictColor(leg.verdict))}>
                    {leg.verdict}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{leg.propType} {leg.side} {leg.line}</span>
                  <span className="font-medium text-foreground">Edge: {leg.edgeScore}/100</span>
                  <span>Kelly: {leg.kellyPercent}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
