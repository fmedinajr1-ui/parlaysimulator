import { useTodayProps, getTodayEasternDate, formatEasternDate, TodayPropPick } from './useTodayProps';

// Re-export for backward compatibility
export type Tomorrow3PTPick = TodayPropPick;

interface UseTomorrow3PTPropsOptions {
  targetDate?: Date;
  minHitRate?: number;
}

export function useTomorrow3PTProps(options: UseTomorrow3PTPropsOptions = {}) {
  return useTodayProps({ 
    propType: 'threes',
    ...options 
  });
}

export { getTodayEasternDate as getTomorrowEasternDate, formatEasternDate };
