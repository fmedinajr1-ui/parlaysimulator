import { Badge } from '@/components/ui/badge';
import { 
  Plane, Clock, Mountain, Calendar, 
  AlertTriangle, Moon, Zap
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface FatigueBreakdownProps {
  isBackToBack: boolean;
  isRoadBackToBack: boolean;
  travelMiles: number;
  timezoneChanges: number;
  isAltitudeGame: boolean;
  isThreeInFour: boolean;
  isFourInSix: boolean;
  isEarlyStart: boolean;
}

const factors = [
  {
    key: 'isBackToBack',
    label: 'B2B',
    points: 22,
    icon: Calendar,
    tooltip: 'Back-to-back game: +22 fatigue points',
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
  {
    key: 'isRoadBackToBack',
    label: 'Road B2B',
    points: 14,
    icon: Plane,
    tooltip: 'Road back-to-back (city-to-city travel): +14 points',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  },
  {
    key: 'isAltitudeGame',
    label: 'Altitude',
    points: 10,
    icon: Mountain,
    tooltip: 'High altitude game (Denver/Utah): +10 points',
    color: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  },
  {
    key: 'isThreeInFour',
    label: '3-in-4',
    points: 12,
    icon: Calendar,
    tooltip: '3 games in 4 days: +12 points',
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  {
    key: 'isFourInSix',
    label: '4-in-6',
    points: 18,
    icon: AlertTriangle,
    tooltip: '4 games in 6 days: +18 points',
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
  {
    key: 'isEarlyStart',
    label: 'Early',
    points: 8,
    icon: Clock,
    tooltip: 'Early start (before 1pm local): +8 points',
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
];

export const FatigueBreakdown = (props: FatigueBreakdownProps) => {
  const activeFactors = factors.filter(f => props[f.key as keyof FatigueBreakdownProps]);
  
  return (
    <TooltipProvider>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {activeFactors.map((factor) => {
            const Icon = factor.icon;
            return (
              <Tooltip key={factor.key}>
                <TooltipTrigger>
                  <Badge 
                    variant="outline" 
                    className={`text-xs ${factor.color} cursor-help`}
                  >
                    <Icon className="w-3 h-3 mr-1" />
                    {factor.label}
                    <span className="ml-1 opacity-75">+{factor.points}</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{factor.tooltip}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
          
          {props.travelMiles > 0 && (
            <Tooltip>
              <TooltipTrigger>
                <Badge 
                  variant="outline" 
                  className="text-xs bg-cyan-500/20 text-cyan-400 border-cyan-500/30 cursor-help"
                >
                  <Plane className="w-3 h-3 mr-1" />
                  {props.travelMiles.toLocaleString()} mi
                  <span className="ml-1 opacity-75">
                    +{Math.round(props.travelMiles / 120)}
                  </span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Travel distance: {props.travelMiles.toLocaleString()} miles (+{Math.round(props.travelMiles / 120)} points)</p>
              </TooltipContent>
            </Tooltip>
          )}
          
          {props.timezoneChanges > 0 && (
            <Tooltip>
              <TooltipTrigger>
                <Badge 
                  variant="outline" 
                  className="text-xs bg-indigo-500/20 text-indigo-400 border-indigo-500/30 cursor-help"
                >
                  <Moon className="w-3 h-3 mr-1" />
                  {props.timezoneChanges}TZ
                  <span className="ml-1 opacity-75">+{props.timezoneChanges * 6}</span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Timezone changes: {props.timezoneChanges} zones (+{props.timezoneChanges * 6} points)</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        
        {activeFactors.length === 0 && props.travelMiles === 0 && props.timezoneChanges === 0 && (
          <div className="flex items-center gap-2 text-green-400 text-xs">
            <Zap className="w-3 h-3" />
            <span>Well-rested - No significant fatigue factors</span>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
