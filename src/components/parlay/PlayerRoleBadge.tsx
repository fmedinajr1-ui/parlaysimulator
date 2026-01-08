import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Star, Shield, Crosshair, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlayerRoleBadgeProps {
  role: string;
  compact?: boolean;
}

const roleConfig: Record<string, { 
  icon: React.ElementType; 
  color: string; 
  label: string;
  emoji: string;
}> = {
  'STAR': { 
    icon: Star, 
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', 
    label: 'Star',
    emoji: '⭐'
  },
  'WING': { 
    icon: Crosshair, 
    color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', 
    label: 'Wing',
    emoji: '🎯'
  },
  'BIG': { 
    icon: Shield, 
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', 
    label: 'Big',
    emoji: '🛡️'
  },
  'SECONDARY_GUARD': { 
    icon: Users, 
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', 
    label: 'Guard',
    emoji: '👥'
  },
};

export function PlayerRoleBadge({ role, compact = false }: PlayerRoleBadgeProps) {
  const config = roleConfig[role] || roleConfig['WING'];
  const Icon = config.icon;
  
  if (compact) {
    return (
      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", config.color)}>
        {config.emoji} {config.label}
      </span>
    );
  }
  
  return (
    <Badge variant="outline" className={cn(config.color, "text-xs")}>
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
}
