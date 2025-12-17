import React from 'react';
import { Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { toast } from '@/hooks/use-toast';

const TEST_NBA_LEGS = [
  {
    description: "LeBron James Over 27.5 Points",
    odds: -115,
    source: 'hitrate' as const,
    playerName: "LeBron James",
    propType: "Points",
    teamName: "Lakers",
    sport: "NBA",
  },
  {
    description: "Jayson Tatum Over 28.5 Points",
    odds: -110,
    source: 'godmode' as const,
    playerName: "Jayson Tatum",
    propType: "Points",
    teamName: "Celtics",
    sport: "NBA",
  },
  {
    description: "Jalen Brunson Over 24.5 Points",
    odds: -105,
    source: 'sharp' as const,
    playerName: "Jalen Brunson",
    propType: "Points",
    teamName: "Knicks",
    sport: "NBA",
  },
];

export const ParlayBuilderDebug = () => {
  const { addLeg, clearParlay } = useParlayBuilder();

  const handleAddTestLegs = () => {
    clearParlay();
    
    TEST_NBA_LEGS.forEach((leg, index) => {
      setTimeout(() => {
        addLeg(leg);
      }, index * 100);
    });

    toast({
      title: "Debug: Added Test NBA Legs",
      description: "3 NBA legs added to test coaching signals",
    });
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleAddTestLegs}
      className="h-7 text-[10px] px-2 border-dashed border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10"
    >
      <Bug className="h-3 w-3 mr-1" />
      Add Test NBA
    </Button>
  );
};
