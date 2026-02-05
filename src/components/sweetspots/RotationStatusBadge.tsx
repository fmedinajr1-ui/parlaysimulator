 import { RefreshCw, Clock, Zap, Coffee } from 'lucide-react';
 import { cn } from '@/lib/utils';
 import type { RotationEstimate } from '@/lib/rotation-patterns';
 import type { PlayerTier } from '@/lib/rotation-patterns';
 
 interface RotationStatusBadgeProps {
   rotationEstimate: RotationEstimate;
   playerTier: PlayerTier;
   className?: string;
 }
 
 /**
  * Visual indicator showing current rotation phase and timing
  */
 export function RotationStatusBadge({ 
   rotationEstimate, 
   playerTier,
   className 
 }: RotationStatusBadgeProps) {
   const { 
     currentPhase, 
     rotationPhase, 
     expectedRemaining, 
     nextTransition,
     closerEligible,
     isInRestWindow,
     restWindowRemaining
   } = rotationEstimate;
   
   // Determine badge color and icon based on phase
   let bgColor = 'bg-primary/10';
   let textColor = 'text-primary';
   let borderColor = 'border-primary/30';
   let Icon = Zap;
   let phaseLabel = 'ACTIVE';
   
   if (currentPhase === 'rest') {
     bgColor = 'bg-muted/20';
     textColor = 'text-muted-foreground';
     borderColor = 'border-muted/30';
     Icon = Coffee;
     phaseLabel = 'BENCH';
   } else if (currentPhase === 'returning') {
     bgColor = 'bg-warning/10';
     textColor = 'text-warning';
     borderColor = 'border-warning/30';
     Icon = RefreshCw;
     phaseLabel = 'RETURNING';
   }
   
   // Rotation phase label
   const phaseLabels: Record<string, string> = {
     first: '1st Rotation',
     second: '2nd Rotation',
     third: '3rd Rotation',
     fourth: '4th Rotation',
     closer: 'Closer Time'
   };
   
   // Tier label
   const tierLabels: Record<PlayerTier, string> = {
     star: '⭐ Star',
     starter: '🏀 Starter',
     role_player: '📋 Bench'
   };
   
   return (
     <div className={cn(
       "flex items-center gap-2 px-2 py-1 rounded border text-xs",
       bgColor, borderColor, textColor,
       className
     )}>
       <Icon className="w-3 h-3" />
       
       <div className="flex flex-col gap-0.5">
         <div className="flex items-center gap-1.5">
           <span className="font-semibold">{phaseLabel}</span>
           <span className="text-muted-foreground">•</span>
           <span className="text-muted-foreground">{phaseLabels[rotationPhase]}</span>
         </div>
         
         <div className="flex items-center gap-1.5 text-[10px]">
           {isInRestWindow ? (
             <span className="text-muted-foreground">
               Returns in ~{Math.ceil(restWindowRemaining)} min
             </span>
           ) : (
             <span>
               ~{Math.round(expectedRemaining)} min remaining
             </span>
           )}
           
           {closerEligible && rotationPhase !== 'closer' && (
             <>
               <span className="text-muted-foreground">•</span>
               <span className="text-primary">Closer ✓</span>
             </>
           )}
         </div>
       </div>
       
       {/* Tier indicator */}
       <div className="ml-auto text-[10px] text-muted-foreground">
         {tierLabels[playerTier]}
       </div>
     </div>
   );
 }
 
 /**
  * Compact inline badge for rotation status
  */
 export function RotationStatusInline({ 
   rotationEstimate,
   className 
 }: { 
   rotationEstimate: RotationEstimate; 
   className?: string;
 }) {
   const { currentPhase, expectedRemaining, isInRestWindow } = rotationEstimate;
   
   if (currentPhase === 'rest') {
     return (
       <span className={cn("text-xs text-muted-foreground", className)}>
         <Coffee className="w-3 h-3 inline mr-1" />
         Bench
       </span>
     );
   }
   
   if (currentPhase === 'returning') {
     return (
       <span className={cn("text-xs text-warning", className)}>
         <RefreshCw className="w-3 h-3 inline mr-1" />
         Returning
       </span>
     );
   }
   
   return (
     <span className={cn("text-xs text-muted-foreground", className)}>
       <Clock className="w-3 h-3 inline mr-1" />
       ~{Math.round(expectedRemaining)}m left
     </span>
   );
 }