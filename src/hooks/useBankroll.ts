import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface BankrollSettings {
  id: string;
  userId: string;
  bankrollAmount: number;
  defaultUnitSize: number;
  kellyMultiplier: number;
  maxBetPercent: number;
  currentWinStreak: number;
  currentLossStreak: number;
  peakBankroll: number;
  totalBets: number;
  totalWon: number;
  totalLost: number;
}

export interface BankrollUpdate {
  bankrollAmount?: number;
  defaultUnitSize?: number;
  kellyMultiplier?: number;
  maxBetPercent?: number;
}

export function useBankroll() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<BankrollSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch bankroll settings
  const fetchBankroll = useCallback(async () => {
    if (!user) {
      setSettings(null);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_bankroll')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          id: data.id,
          userId: data.user_id,
          bankrollAmount: Number(data.bankroll_amount),
          defaultUnitSize: Number(data.default_unit_size),
          kellyMultiplier: Number(data.kelly_multiplier),
          maxBetPercent: Number(data.max_bet_percent),
          currentWinStreak: data.current_win_streak,
          currentLossStreak: data.current_loss_streak,
          peakBankroll: Number(data.peak_bankroll),
          totalBets: data.total_bets,
          totalWon: data.total_won,
          totalLost: data.total_lost,
        });
      } else {
        // Create default settings if none exist
        await createDefaultBankroll();
      }
    } catch (error) {
      console.error('Error fetching bankroll:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Create default bankroll settings
  const createDefaultBankroll = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_bankroll')
        .insert({
          user_id: user.id,
          bankroll_amount: 1000,
          default_unit_size: 0.02,
          kelly_multiplier: 0.5,
          max_bet_percent: 0.05,
          peak_bankroll: 1000
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setSettings({
          id: data.id,
          userId: data.user_id,
          bankrollAmount: Number(data.bankroll_amount),
          defaultUnitSize: Number(data.default_unit_size),
          kellyMultiplier: Number(data.kelly_multiplier),
          maxBetPercent: Number(data.max_bet_percent),
          currentWinStreak: data.current_win_streak,
          currentLossStreak: data.current_loss_streak,
          peakBankroll: Number(data.peak_bankroll),
          totalBets: data.total_bets,
          totalWon: data.total_won,
          totalLost: data.total_lost,
        });
      }
    } catch (error) {
      console.error('Error creating bankroll:', error);
    }
  };

  // Update bankroll settings
  const updateBankroll = async (updates: BankrollUpdate): Promise<boolean> => {
    if (!user || !settings) {
      toast({
        title: "Not logged in",
        description: "Please log in to update bankroll settings",
        variant: "destructive"
      });
      return false;
    }

    try {
      const updateData: Record<string, unknown> = {};
      
      if (updates.bankrollAmount !== undefined) {
        updateData.bankroll_amount = updates.bankrollAmount;
        // Update peak if new amount is higher
        if (updates.bankrollAmount > settings.peakBankroll) {
          updateData.peak_bankroll = updates.bankrollAmount;
        }
      }
      if (updates.defaultUnitSize !== undefined) {
        updateData.default_unit_size = updates.defaultUnitSize;
      }
      if (updates.kellyMultiplier !== undefined) {
        updateData.kelly_multiplier = updates.kellyMultiplier;
      }
      if (updates.maxBetPercent !== undefined) {
        updateData.max_bet_percent = updates.maxBetPercent;
      }

      const { error } = await supabase
        .from('user_bankroll')
        .update(updateData)
        .eq('user_id', user.id);

      if (error) throw error;

      // Refresh settings
      await fetchBankroll();
      
      toast({
        title: "Settings updated",
        description: "Your bankroll settings have been saved"
      });
      
      return true;
    } catch (error) {
      console.error('Error updating bankroll:', error);
      toast({
        title: "Update failed",
        description: "Could not update bankroll settings",
        variant: "destructive"
      });
      return false;
    }
  };

  // Record bet outcome
  const recordBetOutcome = async (won: boolean, amount: number): Promise<boolean> => {
    if (!user || !settings) return false;

    try {
      const newBankroll = won 
        ? settings.bankrollAmount + amount 
        : settings.bankrollAmount - amount;

      const updateData: Record<string, unknown> = {
        bankroll_amount: newBankroll,
        total_bets: settings.totalBets + 1,
        total_won: won ? settings.totalWon + 1 : settings.totalWon,
        total_lost: won ? settings.totalLost : settings.totalLost + 1,
        current_win_streak: won ? settings.currentWinStreak + 1 : 0,
        current_loss_streak: won ? 0 : settings.currentLossStreak + 1
      };

      // Update peak if new bankroll is higher
      if (newBankroll > settings.peakBankroll) {
        updateData.peak_bankroll = newBankroll;
      }

      const { error } = await supabase
        .from('user_bankroll')
        .update(updateData)
        .eq('user_id', user.id);

      if (error) throw error;

      await fetchBankroll();
      return true;
    } catch (error) {
      console.error('Error recording bet outcome:', error);
      return false;
    }
  };

  // Get default unit stake
  const getDefaultStake = (): number => {
    if (!settings) return 20; // Default $20 if no settings
    return settings.bankrollAmount * settings.defaultUnitSize;
  };

  // Get current drawdown percentage
  const getDrawdownPercent = (): number => {
    if (!settings || settings.peakBankroll === 0) return 0;
    return ((settings.peakBankroll - settings.bankrollAmount) / settings.peakBankroll) * 100;
  };

  // Get win rate
  const getWinRate = (): number => {
    if (!settings || settings.totalBets === 0) return 0;
    return (settings.totalWon / settings.totalBets) * 100;
  };

  useEffect(() => {
    fetchBankroll();
  }, [fetchBankroll]);

  return {
    settings,
    isLoading,
    updateBankroll,
    recordBetOutcome,
    getDefaultStake,
    getDrawdownPercent,
    getWinRate,
    refetch: fetchBankroll
  };
}
