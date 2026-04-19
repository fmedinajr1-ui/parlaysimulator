// _shared/narrative-state.ts
// Tracks what phase of the day we're in and what's been sent.
// Read by the orchestrator on every tick. Written after each phase completes.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { DayPhase } from './constants.ts';
import { etDateKey } from './date-et.ts';

export interface DayState {
  date: string;                                    // YYYY-MM-DD (ET)
  phases_completed: DayPhase[];                    // phases already fired today
  slate_size: number | null;                       // # games today
  picks_released: number;                          // count of individual pick drops done
  day_started_at: string | null;                   // ISO
  day_notes: Record<string, any>;                  // free-form: tone carried forward, themes, etc.
}

const EMPTY_STATE = (date: string): DayState => ({
  date,
  phases_completed: [],
  slate_size: null,
  picks_released: 0,
  day_started_at: null,
  day_notes: {},
});

export async function loadDayState(sb: SupabaseClient, date?: string): Promise<DayState> {
  const dateKey = date || etDateKey();
  const { data } = await sb
    .from('bot_day_state')
    .select('*')
    .eq('date', dateKey)
    .maybeSingle();
  if (!data) return EMPTY_STATE(dateKey);
  return {
    date: data.date,
    phases_completed: data.phases_completed || [],
    slate_size: data.slate_size,
    picks_released: data.picks_released || 0,
    day_started_at: data.day_started_at,
    day_notes: data.day_notes || {},
  };
}

export async function saveDayState(sb: SupabaseClient, state: DayState): Promise<void> {
  await sb.from('bot_day_state').upsert({
    date: state.date,
    phases_completed: state.phases_completed,
    slate_size: state.slate_size,
    picks_released: state.picks_released,
    day_started_at: state.day_started_at,
    day_notes: state.day_notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'date' });
}

export async function markPhaseComplete(sb: SupabaseClient, phase: DayPhase): Promise<void> {
  const state = await loadDayState(sb);
  if (!state.phases_completed.includes(phase)) {
    state.phases_completed.push(phase);
    await saveDayState(sb, state);
  }
}

export async function phaseAlreadyFired(sb: SupabaseClient, phase: DayPhase): Promise<boolean> {
  const state = await loadDayState(sb);
  return state.phases_completed.includes(phase);
}

/** Records a day-note — anything the orchestrator wants to remember and potentially call back to. */
export async function noteDayFact(sb: SupabaseClient, key: string, value: any): Promise<void> {
  const state = await loadDayState(sb);
  state.day_notes[key] = value;
  await saveDayState(sb, state);
}

/** Reads a previously-stored day-note. */
export async function readDayFact(sb: SupabaseClient, key: string): Promise<any> {
  const state = await loadDayState(sb);
  return state.day_notes[key];
}
