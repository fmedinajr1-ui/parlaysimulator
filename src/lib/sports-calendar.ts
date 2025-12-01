// Championship and major sports event calendar data
export interface ChampionshipEvent {
  sport: string;
  event: string;
  emoji: string;
  month: number;
  dayRange?: [number, number];
  specificDay?: number;
  hotTip: string;
  upsetProne: boolean;
}

export const CHAMPIONSHIP_CALENDAR: ChampionshipEvent[] = [
  // NFL
  { sport: 'NFL', event: 'Wild Card Weekend', emoji: '🏈', month: 1, dayRange: [6, 8], hotTip: 'Upsets common in first round', upsetProne: true },
  { sport: 'NFL', event: 'Divisional Round', emoji: '🏈', month: 1, dayRange: [13, 15], hotTip: 'Home teams dominate', upsetProne: false },
  { sport: 'NFL', event: 'Conference Championships', emoji: '🏈', month: 1, dayRange: [20, 21], hotTip: 'Experience matters', upsetProne: false },
  { sport: 'NFL', event: 'Super Bowl', emoji: '🏆', month: 2, specificDay: 9, hotTip: 'Highest betting volume day', upsetProne: false },
  { sport: 'NFL', event: 'Thanksgiving Games', emoji: '🦃', month: 11, specificDay: 28, hotTip: 'Prime time parlays', upsetProne: false },
  
  // NBA
  { sport: 'NBA', event: 'Play-In Tournament', emoji: '🏀', month: 4, dayRange: [15, 19], hotTip: 'Must-win games, intensity high', upsetProne: true },
  { sport: 'NBA', event: 'First Round Playoffs', emoji: '🏀', month: 4, dayRange: [20, 30], hotTip: 'Favorites usually advance', upsetProne: false },
  { sport: 'NBA', event: 'Conference Finals', emoji: '🏀', month: 5, dayRange: [15, 30], hotTip: 'Stars deliver in crunch time', upsetProne: false },
  { sport: 'NBA', event: 'NBA Finals', emoji: '🏆', month: 6, dayRange: [1, 20], hotTip: 'Home court matters', upsetProne: false },
  { sport: 'NBA', event: 'Christmas Games', emoji: '🎄', month: 12, specificDay: 25, hotTip: 'Showcase games, unpredictable', upsetProne: true },
  
  // NHL
  { sport: 'NHL', event: 'First Round Playoffs', emoji: '🏒', month: 4, dayRange: [15, 30], hotTip: 'Physical play increases', upsetProne: true },
  { sport: 'NHL', event: 'Conference Finals', emoji: '🏒', month: 5, dayRange: [15, 31], hotTip: 'Goalies make the difference', upsetProne: false },
  { sport: 'NHL', event: 'Stanley Cup Finals', emoji: '🏆', month: 6, dayRange: [1, 25], hotTip: 'Experience and depth win', upsetProne: false },
  
  // College Football
  { sport: 'NCAAF', event: 'College Football Playoff', emoji: '🏈', month: 12, dayRange: [20, 31], hotTip: 'Bowl season intensity', upsetProne: false },
  { sport: 'NCAAF', event: 'National Championship', emoji: '🏆', month: 1, specificDay: 13, hotTip: 'Elite matchup', upsetProne: false },
];

export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function getUpcomingEvents(count: number = 5): ChampionshipEvent[] {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  
  // Sort events by how soon they are
  const sortedEvents = [...CHAMPIONSHIP_CALENDAR].sort((a, b) => {
    const aMonth = a.month;
    const bMonth = b.month;
    const aDay = a.specificDay || (a.dayRange ? a.dayRange[0] : 15);
    const bDay = b.specificDay || (b.dayRange ? b.dayRange[0] : 15);
    
    // Calculate days until event (accounting for year wrap)
    const aDaysUntil = ((aMonth - currentMonth + 12) % 12) * 30 + (aDay - currentDay);
    const bDaysUntil = ((bMonth - currentMonth + 12) % 12) * 30 + (bDay - currentDay);
    
    return aDaysUntil - bDaysUntil;
  });
  
  return sortedEvents.slice(0, count);
}

export function isEventThisMonth(event: ChampionshipEvent): boolean {
  const currentMonth = new Date().getMonth() + 1;
  return event.month === currentMonth;
}
