 /**
  * NBA Rotation Pattern Model
  * Models typical rotation timing by player tier to estimate when players are on/off court
  */
 
 export type PlayerTier = 'star' | 'starter' | 'role_player';
 export type RotationPhase = 'first' | 'second' | 'third' | 'fourth' | 'closer';
 
 export interface RotationWindow {
   startQuarter: number;
   startClock: number; // Minutes remaining in quarter (12 = start, 0 = end)
   endQuarter: number;
   endClock: number;
   onCourt: boolean;
   expectedMinutes: number;
 }
 
 export interface RotationEstimate {
   expectedRemaining: number;      // Rotation-aware remaining minutes
   uncertaintyRange: [number, number]; // Low/high range
   currentPhase: 'active' | 'rest' | 'returning';
   rotationPhase: RotationPhase;
   nextTransition: string;         // "Likely to sit in ~4 min"
   closerEligible: boolean;        // Could play closing minutes?
   isInRestWindow: boolean;
   restWindowRemaining: number;    // Minutes until rest ends
   rotationInsight: string;
 }
 
 // Define typical rotation windows for each tier
 // Based on NBA coaching patterns: stars play ~36-38 min, starters ~28-32, bench ~14-20
 
 // Stars: Play start of Q1 + Q3, sit mid-Q2 + mid-Q4, close out
 const STAR_ROTATION_WINDOWS: RotationWindow[] = [
   { startQuarter: 1, startClock: 12, endQuarter: 1, endClock: 5, onCourt: true, expectedMinutes: 7 },
   { startQuarter: 1, startClock: 5, endQuarter: 2, endClock: 8, onCourt: false, expectedMinutes: 0 }, // Rest
   { startQuarter: 2, startClock: 8, endQuarter: 2, endClock: 0, onCourt: true, expectedMinutes: 8 },
   { startQuarter: 3, startClock: 12, endQuarter: 3, endClock: 5, onCourt: true, expectedMinutes: 7 },
   { startQuarter: 3, startClock: 5, endQuarter: 4, endClock: 8, onCourt: false, expectedMinutes: 0 }, // Rest
   { startQuarter: 4, startClock: 8, endQuarter: 4, endClock: 0, onCourt: true, expectedMinutes: 8 },
 ];
 
 // Starters: Similar but shorter stints
 const STARTER_ROTATION_WINDOWS: RotationWindow[] = [
   { startQuarter: 1, startClock: 12, endQuarter: 1, endClock: 6, onCourt: true, expectedMinutes: 6 },
   { startQuarter: 1, startClock: 6, endQuarter: 2, endClock: 6, onCourt: false, expectedMinutes: 0 },
   { startQuarter: 2, startClock: 6, endQuarter: 2, endClock: 0, onCourt: true, expectedMinutes: 6 },
   { startQuarter: 3, startClock: 12, endQuarter: 3, endClock: 6, onCourt: true, expectedMinutes: 6 },
   { startQuarter: 3, startClock: 6, endQuarter: 4, endClock: 6, onCourt: false, expectedMinutes: 0 },
   { startQuarter: 4, startClock: 6, endQuarter: 4, endClock: 0, onCourt: true, expectedMinutes: 6 },
 ];
 
 // Bench/Role players: Opposite pattern - play when starters rest
 const ROLE_PLAYER_ROTATION_WINDOWS: RotationWindow[] = [
   { startQuarter: 1, startClock: 12, endQuarter: 1, endClock: 6, onCourt: false, expectedMinutes: 0 },
   { startQuarter: 1, startClock: 6, endQuarter: 2, endClock: 6, onCourt: true, expectedMinutes: 6 },
   { startQuarter: 2, startClock: 6, endQuarter: 2, endClock: 0, onCourt: false, expectedMinutes: 0 },
   { startQuarter: 3, startClock: 12, endQuarter: 3, endClock: 6, onCourt: false, expectedMinutes: 0 },
   { startQuarter: 3, startClock: 6, endQuarter: 4, endClock: 6, onCourt: true, expectedMinutes: 6 },
   { startQuarter: 4, startClock: 6, endQuarter: 4, endClock: 0, onCourt: false, expectedMinutes: 0 },
 ];
 
 const ROTATION_WINDOWS: Record<PlayerTier, RotationWindow[]> = {
   star: STAR_ROTATION_WINDOWS,
   starter: STARTER_ROTATION_WINDOWS,
   role_player: ROLE_PLAYER_ROTATION_WINDOWS,
 };
 
 // Convert quarter + clock to total game minutes elapsed (0-48)
 export function getGameMinutesElapsed(quarter: number, clockMinutes: number): number {
   const completedQuarters = Math.max(0, quarter - 1);
   const minutesInCurrentQuarter = 12 - clockMinutes;
   return completedQuarters * 12 + minutesInCurrentQuarter;
 }
 
 // Convert window boundary to game minutes
 function windowToGameMinutes(quarter: number, clock: number): number {
   return (quarter - 1) * 12 + (12 - clock);
 }
 
 // Check if current game time is within a window
 function isInWindow(gameMinutes: number, window: RotationWindow): boolean {
   const windowStart = windowToGameMinutes(window.startQuarter, window.startClock);
   const windowEnd = windowToGameMinutes(window.endQuarter, window.endClock);
   return gameMinutes >= windowStart && gameMinutes < windowEnd;
 }
 
 // Find current window for player
 function getCurrentWindow(tier: PlayerTier, gameMinutes: number): RotationWindow | null {
   const windows = ROTATION_WINDOWS[tier];
   for (const window of windows) {
     if (isInWindow(gameMinutes, window)) {
       return window;
     }
   }
   return null;
 }
 
 // Get remaining play minutes from current position
 function getRemainingPlayMinutes(tier: PlayerTier, gameMinutes: number): number {
   const windows = ROTATION_WINDOWS[tier];
   let totalMinutes = 0;
   
   for (const window of windows) {
     const windowStart = windowToGameMinutes(window.startQuarter, window.startClock);
     const windowEnd = windowToGameMinutes(window.endQuarter, window.endClock);
     
     if (windowEnd <= gameMinutes) continue; // Window already passed
     if (!window.onCourt) continue; // Rest window, no play minutes
     
     if (gameMinutes >= windowStart) {
       // Currently in this window - partial minutes
       totalMinutes += windowEnd - gameMinutes;
     } else {
       // Future window - full minutes
       totalMinutes += window.expectedMinutes;
     }
   }
   
   return totalMinutes;
 }
 
 // Determine rotation phase based on quarter and clock
 export function getRotationPhase(quarter: number, clockMinutes: number): RotationPhase {
   if (quarter === 1) return 'first';
   if (quarter === 2) return clockMinutes >= 6 ? 'first' : 'second';
   if (quarter === 3) return 'third';
   if (quarter === 4) {
     if (clockMinutes <= 5) return 'closer';
     return clockMinutes >= 6 ? 'third' : 'fourth';
   }
   return 'fourth';
 }
 
 // Infer player tier from minutes played or name patterns
 export function inferPlayerTier(
   minutesPlayed: number,
   gameProgress: number,
   avgMinutes?: number
 ): PlayerTier {
   // Use average minutes if available
   if (avgMinutes !== undefined) {
     if (avgMinutes >= 32) return 'star';
     if (avgMinutes >= 24) return 'starter';
     return 'role_player';
   }
   
   // Infer from current game data
   const expectedMinutes = (gameProgress / 100) * 48;
   if (expectedMinutes <= 0) return 'starter'; // Default at game start
   
   const minutesPace = minutesPlayed / (expectedMinutes / 48);
   
   if (minutesPace >= 0.75) return 'star';     // On pace for 36+ min
   if (minutesPace >= 0.55) return 'starter';   // On pace for 26-36 min
   return 'role_player';                        // On pace for <26 min
 }
 
 // Get time until next rotation transition
 function getNextTransition(tier: PlayerTier, gameMinutes: number): { minutesUntil: number; toState: 'rest' | 'play' } {
   const windows = ROTATION_WINDOWS[tier];
   
   for (const window of windows) {
     const windowStart = windowToGameMinutes(window.startQuarter, window.startClock);
     const windowEnd = windowToGameMinutes(window.endQuarter, window.endClock);
     
     if (gameMinutes >= windowStart && gameMinutes < windowEnd) {
       // Currently in this window - next transition is end of window
       return {
         minutesUntil: windowEnd - gameMinutes,
         toState: window.onCourt ? 'rest' : 'play'
       };
     }
   }
   
   return { minutesUntil: 0, toState: 'play' };
 }
 
 /**
  * Calculate rotation-aware remaining minutes estimate
  */
 export function calculateRotationMinutes(
   tier: PlayerTier,
   currentQuarter: number,
   clockMinutes: number,
   scoreDiff: number = 0,
   minutesPlayedSoFar: number = 0
 ): RotationEstimate {
   const gameMinutes = getGameMinutesElapsed(currentQuarter, clockMinutes);
   const currentWindow = getCurrentWindow(tier, gameMinutes);
   const baseRemaining = getRemainingPlayMinutes(tier, gameMinutes);
   const nextTransition = getNextTransition(tier, gameMinutes);
   const rotationPhase = getRotationPhase(currentQuarter, clockMinutes);
   
   // Determine current phase
   let currentPhase: 'active' | 'rest' | 'returning' = 'active';
   if (currentWindow && !currentWindow.onCourt) {
     currentPhase = nextTransition.minutesUntil < 3 ? 'returning' : 'rest';
   }
   
   // Apply game context adjustments
   let adjustedRemaining = baseRemaining;
   let closerEligible = tier === 'star' || tier === 'starter';
   
   // Close game bonus: Stars play through in tight games
   if (currentQuarter === 4 && Math.abs(scoreDiff) <= 8 && tier === 'star') {
     adjustedRemaining += 3; // Stars play extra in close games
     closerEligible = true;
   }
   
   // Blowout penalty: Starters sit early in blowouts
   if (Math.abs(scoreDiff) >= 20 && currentQuarter >= 3) {
     if (tier === 'star') {
       adjustedRemaining *= 0.5; // Heavy reduction
       closerEligible = false;
     } else if (tier === 'starter') {
       adjustedRemaining *= 0.6;
       closerEligible = false;
     } else {
       adjustedRemaining *= 1.3; // Bench gets more time in blowouts
     }
   }
   
   // Cap minutes based on typical totals
   const maxExpected = tier === 'star' ? 38 : tier === 'starter' ? 32 : 20;
   adjustedRemaining = Math.min(adjustedRemaining, Math.max(0, maxExpected - minutesPlayedSoFar));
   
   // Calculate uncertainty range (±15% for stars, ±25% for role players)
   const uncertaintyPct = tier === 'star' ? 0.15 : tier === 'starter' ? 0.20 : 0.25;
   const uncertaintyRange: [number, number] = [
     Math.max(0, adjustedRemaining * (1 - uncertaintyPct)),
     adjustedRemaining * (1 + uncertaintyPct)
   ];
   
   // Generate insight text
   let rotationInsight = '';
   let nextTransitionText = '';
   
   if (currentPhase === 'rest') {
     rotationInsight = `${tier === 'star' ? 'Star' : tier === 'starter' ? 'Starter' : 'Role player'} in typical rest window.`;
     nextTransitionText = `Returns in ~${Math.ceil(nextTransition.minutesUntil)} min`;
   } else if (currentPhase === 'returning') {
     rotationInsight = `About to re-enter game.`;
     nextTransitionText = `Entering game soon`;
   } else {
     if (nextTransition.toState === 'rest' && nextTransition.minutesUntil < 4) {
       rotationInsight = `Approaching bench rotation in ${Math.ceil(nextTransition.minutesUntil)} min.`;
       nextTransitionText = `Rest window in ~${Math.ceil(nextTransition.minutesUntil)} min`;
     } else {
       rotationInsight = `Active in rotation. ~${Math.round(adjustedRemaining)} min remaining.`;
       nextTransitionText = nextTransition.minutesUntil > 0 
         ? `${nextTransition.toState === 'rest' ? 'Rest' : 'Playing'} for ~${Math.ceil(nextTransition.minutesUntil)} more min`
         : '';
     }
   }
   
   // Add closer context for late game
   if (currentQuarter === 4 && clockMinutes <= 8 && closerEligible) {
     rotationInsight += ' Closer-eligible for crunch time.';
   }
   
   return {
     expectedRemaining: Math.round(adjustedRemaining * 10) / 10,
     uncertaintyRange,
     currentPhase,
     rotationPhase,
     nextTransition: nextTransitionText,
     closerEligible,
     isInRestWindow: currentPhase === 'rest',
     restWindowRemaining: currentPhase === 'rest' ? nextTransition.minutesUntil : 0,
     rotationInsight
   };
 }
 
 /**
  * Check if player is approaching a rest window (within 3 minutes)
  */
 export function isApproachingRestWindow(
   tier: PlayerTier,
   currentQuarter: number,
   clockMinutes: number
 ): boolean {
   const gameMinutes = getGameMinutesElapsed(currentQuarter, clockMinutes);
   const currentWindow = getCurrentWindow(tier, gameMinutes);
   
   if (!currentWindow || !currentWindow.onCourt) return false;
   
   const windowEnd = windowToGameMinutes(currentWindow.endQuarter, currentWindow.endClock);
   const minutesUntilRest = windowEnd - gameMinutes;
   
   return minutesUntilRest <= 3 && minutesUntilRest > 0;
 }
 
 /**
  * Get expected minutes breakdown by remaining quarters
  */
 export function getMinutesBreakdown(
   tier: PlayerTier,
   currentQuarter: number,
   clockMinutes: number
 ): { thisQuarter: number; q2: number; q3: number; q4: number; closer: number } {
   const breakdown = { thisQuarter: 0, q2: 0, q3: 0, q4: 0, closer: 0 };
   const windows = ROTATION_WINDOWS[tier];
   const gameMinutes = getGameMinutesElapsed(currentQuarter, clockMinutes);
   
   for (const window of windows) {
     if (!window.onCourt) continue;
     
     const windowStart = windowToGameMinutes(window.startQuarter, window.startClock);
     const windowEnd = windowToGameMinutes(window.endQuarter, window.endClock);
     
     if (windowEnd <= gameMinutes) continue; // Already passed
     
     // Calculate effective minutes in this window
     const effectiveStart = Math.max(windowStart, gameMinutes);
     const effectiveMinutes = windowEnd - effectiveStart;
     
     // Assign to appropriate quarter bucket
     if (window.endQuarter === currentQuarter) {
       breakdown.thisQuarter += effectiveMinutes;
     } else if (window.endQuarter === 2) {
       breakdown.q2 += effectiveMinutes;
     } else if (window.endQuarter === 3) {
       breakdown.q3 += effectiveMinutes;
     } else if (window.endQuarter === 4) {
       if (window.endClock <= 5) {
         breakdown.closer += effectiveMinutes;
       } else {
         breakdown.q4 += effectiveMinutes;
       }
     }
   }
   
   return breakdown;
 }