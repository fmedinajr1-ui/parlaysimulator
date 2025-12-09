// ParlayBuilderContext - Universal Parlay Builder State Management
import * as React from 'react';
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { UniversalLeg, ParlaySource } from '@/types/universal-parlay';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ParlaySimulation, DegenerateLevel } from '@/types/parlay';

interface ParlayBuilderContextType {
  legs: UniversalLeg[];
  isExpanded: boolean;
  legCount: number;
  combinedOdds: number;
  winProbability: number;
  addLeg: (leg: Omit<UniversalLeg, 'id' | 'addedAt'>) => void;
  removeLeg: (id: string) => void;
  clearParlay: () => void;
  toggleExpanded: () => void;
  setExpanded: (expanded: boolean) => void;
  saveParlay: (stake: number) => Promise<boolean>;
  analyzeParlay: () => void;
  compareParlay: () => void;
  hasLeg: (description: string) => boolean;
}

const ParlayBuilderContext = createContext<ParlayBuilderContextType | undefined>(undefined);

const STORAGE_KEY = 'universal-parlay-builder';

function americanToImplied(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

function americanToDecimal(odds: number): number {
  if (odds > 0) {
    return (odds / 100) + 1;
  } else {
    return (100 / Math.abs(odds)) + 1;
  }
}

function calculateCombinedOdds(legs: UniversalLeg[]): number {
  if (legs.length === 0) return 0;
  
  const decimalOdds = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  
  // Convert back to American
  if (decimalOdds >= 2) {
    return Math.round((decimalOdds - 1) * 100);
  } else {
    return Math.round(-100 / (decimalOdds - 1));
  }
}

function calculateWinProbability(legs: UniversalLeg[]): number {
  if (legs.length === 0) return 0;
  return legs.reduce((acc, leg) => acc * americanToImplied(leg.odds), 1) * 100;
}

export const ParlayBuilderProvider = ({ children }: { children: ReactNode }) => {
  const [legs, setLegs] = useState<UniversalLeg[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setLegs(parsed.legs || []);
      }
    } catch (e) {
      console.error('Failed to load parlay from storage:', e);
    }
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ legs }));
    } catch (e) {
      console.error('Failed to save parlay to storage:', e);
    }
  }, [legs]);

  const addLeg = useCallback((leg: Omit<UniversalLeg, 'id' | 'addedAt'>) => {
    const newLeg: UniversalLeg = {
      ...leg,
      id: crypto.randomUUID(),
      addedAt: new Date().toISOString(),
    };
    
    setLegs(prev => [...prev, newLeg]);
    setIsExpanded(true);
    
    toast({
      title: "Added to Parlay",
      description: leg.description,
    });
  }, [toast]);

  const removeLeg = useCallback((id: string) => {
    setLegs(prev => prev.filter(leg => leg.id !== id));
  }, []);

  const clearParlay = useCallback(() => {
    setLegs([]);
    setIsExpanded(false);
    toast({
      title: "Parlay Cleared",
      description: "All legs have been removed",
    });
  }, [toast]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  const hasLeg = useCallback((description: string) => {
    return legs.some(leg => leg.description.toLowerCase() === description.toLowerCase());
  }, [legs]);

  const saveParlay = useCallback(async (stake: number): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast({
          title: "Sign in Required",
          description: "Please sign in to save parlays",
          variant: "destructive",
        });
        return false;
      }

      const combinedOdds = calculateCombinedOdds(legs);
      const winProb = calculateWinProbability(legs);
      const decimalOdds = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
      const potentialPayout = stake * decimalOdds;

      const degenerateLevel = winProb < 1 ? 'LOAN_NEEDED' 
        : winProb < 5 ? 'LOTTERY_TICKET'
        : winProb < 15 ? 'SWEAT_SEASON'
        : winProb < 30 ? 'NOT_TERRIBLE'
        : 'RESPECTABLE';

      const formattedLegs = legs.map(leg => ({
        description: leg.description,
        odds: leg.odds,
        impliedProbability: americanToImplied(leg.odds),
        riskLevel: americanToImplied(leg.odds) > 0.6 ? 'low' : americanToImplied(leg.odds) > 0.4 ? 'medium' : 'high',
        source: leg.source,
        playerName: leg.playerName,
        propType: leg.propType,
      }));

      const { error } = await supabase.from('parlay_history').insert({
        user_id: user.id,
        legs: formattedLegs,
        stake,
        potential_payout: potentialPayout,
        combined_probability: winProb / 100,
        degenerate_level: degenerateLevel,
        is_settled: false,
      });

      if (error) throw error;

      toast({
        title: "Parlay Saved!",
        description: `${legs.length} leg parlay saved to your history`,
      });

      clearParlay();
      return true;
    } catch (e) {
      console.error('Failed to save parlay:', e);
      toast({
        title: "Save Failed",
        description: "Could not save parlay. Please try again.",
        variant: "destructive",
      });
      return false;
    }
  }, [legs, toast, clearParlay]);

  const analyzeParlay = useCallback(() => {
    if (legs.length === 0) {
      toast({
        title: "No Legs",
        description: "Add some picks to your parlay first",
        variant: "destructive",
      });
      return;
    }

    // Build simulation object that Results page expects
    const combinedProb = calculateWinProbability(legs) / 100;
    const degLevel: DegenerateLevel = combinedProb < 0.01 ? 'LOAN_NEEDED' 
      : combinedProb < 0.05 ? 'LOTTERY_TICKET'
      : combinedProb < 0.15 ? 'SWEAT_SEASON'
      : combinedProb < 0.30 ? 'NOT_TERRIBLE'
      : 'RESPECTABLE';
    
    const decimalOdds = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
    const totalOddsAmerican = calculateCombinedOdds(legs);
    
    const simulation: ParlaySimulation = {
      legs: legs.map((leg, index) => ({
        id: leg.id || `leg-${index}`,
        description: leg.description,
        odds: leg.odds,
        impliedProbability: americanToImplied(leg.odds),
        riskLevel: americanToImplied(leg.odds) > 0.6 ? 'low' as const : 
                   americanToImplied(leg.odds) > 0.4 ? 'medium' as const : 'high' as const,
      })),
      stake: 10,
      totalOdds: totalOddsAmerican,
      potentialPayout: 10 * decimalOdds,
      combinedProbability: combinedProb,
      degenerateLevel: degLevel,
      trashTalk: [],
      expectedValue: (combinedProb * 10 * decimalOdds) - 10,
      simulationHighlights: [],
    };

    navigate('/results', { state: { simulation } });
  }, [legs, navigate, toast]);

  const compareParlay = useCallback(() => {
    if (legs.length === 0) {
      toast({
        title: "No Legs",
        description: "Add some picks to your parlay first",
        variant: "destructive",
      });
      return;
    }

    // Store parlay data for Compare page to pick up
    sessionStorage.setItem('compare-parlay', JSON.stringify(legs));
    navigate('/compare');
  }, [legs, navigate, toast]);

  const combinedOdds = calculateCombinedOdds(legs);
  const winProbability = calculateWinProbability(legs);

  return (
    <ParlayBuilderContext.Provider
      value={{
        legs,
        isExpanded,
        legCount: legs.length,
        combinedOdds,
        winProbability,
        addLeg,
        removeLeg,
        clearParlay,
        toggleExpanded,
        setExpanded: setIsExpanded,
        saveParlay,
        analyzeParlay,
        compareParlay,
        hasLeg,
      }}
    >
      {children}
    </ParlayBuilderContext.Provider>
  );
};

export const useParlayBuilder = () => {
  const context = useContext(ParlayBuilderContext);
  if (context === undefined) {
    throw new Error('useParlayBuilder must be used within a ParlayBuilderProvider');
  }
  return context;
};
