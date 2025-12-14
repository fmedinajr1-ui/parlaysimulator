import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { 
  Wallet, 
  Settings, 
  TrendingUp, 
  TrendingDown, 
  Target,
  PiggyBank,
  Percent,
  Save
} from "lucide-react";
import { useBankroll } from "@/hooks/useBankroll";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function BankrollManager() {
  const { 
    settings, 
    isLoading, 
    updateBankroll, 
    getDrawdownPercent, 
    getWinRate 
  } = useBankroll();
  
  const [editMode, setEditMode] = useState(false);
  const [formValues, setFormValues] = useState({
    bankrollAmount: 1000,
    defaultUnitSize: 2,
    kellyMultiplier: 50,
    maxBetPercent: 5
  });
  const [isSaving, setIsSaving] = useState(false);

  // Sync form with settings when loaded
  const initForm = () => {
    if (settings) {
      setFormValues({
        bankrollAmount: settings.bankrollAmount,
        defaultUnitSize: settings.defaultUnitSize * 100,
        kellyMultiplier: settings.kellyMultiplier * 100,
        maxBetPercent: settings.maxBetPercent * 100
      });
    }
    setEditMode(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const success = await updateBankroll({
      bankrollAmount: formValues.bankrollAmount,
      defaultUnitSize: formValues.defaultUnitSize / 100,
      kellyMultiplier: formValues.kellyMultiplier / 100,
      maxBetPercent: formValues.maxBetPercent / 100
    });
    setIsSaving(false);
    if (success) {
      setEditMode(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const drawdownPercent = getDrawdownPercent();
  const winRate = getWinRate();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Bankroll Manager
          </CardTitle>
          {!editMode ? (
            <Button variant="outline" size="sm" onClick={initForm}>
              <Settings className="w-4 h-4 mr-2" />
              Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditMode(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {editMode ? (
          // Edit Mode
          <div className="space-y-6">
            {/* Bankroll Amount */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <PiggyBank className="w-4 h-4" />
                Current Bankroll
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={formValues.bankrollAmount}
                  onChange={(e) => setFormValues(prev => ({ 
                    ...prev, 
                    bankrollAmount: parseFloat(e.target.value) || 0 
                  }))}
                  className="pl-8"
                />
              </div>
            </div>

            {/* Default Unit Size */}
            <div className="space-y-2">
              <Label className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Default Unit Size
                </span>
                <span className="text-sm text-muted-foreground">
                  {formValues.defaultUnitSize}% = ${((formValues.bankrollAmount * formValues.defaultUnitSize) / 100).toFixed(2)}
                </span>
              </Label>
              <Slider
                value={[formValues.defaultUnitSize]}
                onValueChange={([value]) => setFormValues(prev => ({ ...prev, defaultUnitSize: value }))}
                min={0.5}
                max={10}
                step={0.5}
              />
            </div>

            {/* Kelly Multiplier */}
            <div className="space-y-2">
              <Label className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Percent className="w-4 h-4" />
                  Kelly Multiplier
                </span>
                <span className="text-sm text-muted-foreground">
                  {formValues.kellyMultiplier}% Kelly
                </span>
              </Label>
              <Slider
                value={[formValues.kellyMultiplier]}
                onValueChange={([value]) => setFormValues(prev => ({ ...prev, kellyMultiplier: value }))}
                min={25}
                max={100}
                step={25}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Quarter</span>
                <span>Half</span>
                <span>3/4</span>
                <span>Full</span>
              </div>
            </div>

            {/* Max Bet Percent */}
            <div className="space-y-2">
              <Label className="flex items-center justify-between">
                <span>Max Bet (% of bankroll)</span>
                <span className="text-sm text-muted-foreground">
                  {formValues.maxBetPercent}% = ${((formValues.bankrollAmount * formValues.maxBetPercent) / 100).toFixed(2)}
                </span>
              </Label>
              <Slider
                value={[formValues.maxBetPercent]}
                onValueChange={([value]) => setFormValues(prev => ({ ...prev, maxBetPercent: value }))}
                min={1}
                max={15}
                step={1}
              />
            </div>
          </div>
        ) : (
          // View Mode
          <>
            {/* Main Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-muted/50 text-center">
                <PiggyBank className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                <p className="text-2xl font-bold">${settings?.bankrollAmount.toLocaleString() ?? 0}</p>
                <p className="text-xs text-muted-foreground">Current Bankroll</p>
              </div>
              <div className="p-4 rounded-xl bg-neon-cyan/10 text-center border border-neon-cyan/20">
                <Target className="w-6 h-6 mx-auto mb-2 text-neon-cyan" />
                <p className="text-2xl font-bold text-neon-cyan">
                  ${((settings?.bankrollAmount ?? 0) * (settings?.defaultUnitSize ?? 0.02)).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">Default Unit</p>
              </div>
            </div>

            {/* Performance Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <p className="text-lg font-bold">{settings?.totalBets ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total Bets</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <p className={`text-lg font-bold ${winRate >= 50 ? 'text-neon-green' : 'text-neon-red'}`}>
                  {winRate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">Win Rate</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="flex items-center justify-center gap-1">
                  {settings?.currentWinStreak ? (
                    <>
                      <TrendingUp className="w-4 h-4 text-neon-green" />
                      <p className="text-lg font-bold text-neon-green">{settings.currentWinStreak}</p>
                    </>
                  ) : settings?.currentLossStreak ? (
                    <>
                      <TrendingDown className="w-4 h-4 text-neon-red" />
                      <p className="text-lg font-bold text-neon-red">{settings.currentLossStreak}</p>
                    </>
                  ) : (
                    <p className="text-lg font-bold">0</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Streak</p>
              </div>
            </div>

            {/* Drawdown Meter */}
            {drawdownPercent > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Drawdown from Peak</span>
                  <Badge 
                    variant="outline" 
                    className={drawdownPercent > 20 ? 'text-neon-red' : 'text-amber-500'}
                  >
                    -{drawdownPercent.toFixed(1)}%
                  </Badge>
                </div>
                <Progress value={drawdownPercent} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  Peak: ${settings?.peakBankroll.toLocaleString() ?? 0}
                </p>
              </div>
            )}

            {/* Settings Summary */}
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-2">Current Settings</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {((settings?.kellyMultiplier ?? 0.5) * 100)}% Kelly
                </Badge>
                <Badge variant="secondary">
                  {((settings?.defaultUnitSize ?? 0.02) * 100)}% Unit
                </Badge>
                <Badge variant="secondary">
                  {((settings?.maxBetPercent ?? 0.05) * 100)}% Max
                </Badge>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
