// Hints hook - user hint and tutorial state management
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

type HintId = 
  | 'upload-intro'
  | 'suggestions-swipe'
  | 'compare-add'
  | 'odds-tracking'
  | 'profile-stats'
  | 'sharp-follow';

interface HintsState {
  hintsEnabled: boolean;
  dismissedHints: Record<string, boolean>;
}

export function useHints() {
  const { user } = useAuth();
  const [state, setState] = useState<HintsState>({
    hintsEnabled: true,
    dismissedHints: {},
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    const fetchHintsState = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('hints_enabled, tutorial_completed')
          .eq('user_id', user.id)
          .single();

        if (error) throw error;

        setState({
          hintsEnabled: data?.hints_enabled ?? true,
          dismissedHints: (data?.tutorial_completed as Record<string, boolean>) || {},
        });
      } catch (err) {
        console.error('Error fetching hints state:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHintsState();
  }, [user]);

  const dismissHint = useCallback(async (hintId: HintId) => {
    if (!user) return;

    const newDismissed = { ...state.dismissedHints, [hintId]: true };
    setState(prev => ({ ...prev, dismissedHints: newDismissed }));

    try {
      await supabase
        .from('profiles')
        .update({ tutorial_completed: newDismissed })
        .eq('user_id', user.id);
    } catch (err) {
      console.error('Error dismissing hint:', err);
    }
  }, [user, state.dismissedHints]);

  const toggleHints = useCallback(async (enabled: boolean) => {
    if (!user) return;

    setState(prev => ({ ...prev, hintsEnabled: enabled }));

    try {
      await supabase
        .from('profiles')
        .update({ hints_enabled: enabled })
        .eq('user_id', user.id);
    } catch (err) {
      console.error('Error toggling hints:', err);
    }
  }, [user]);

  const shouldShowHint = useCallback((hintId: HintId): boolean => {
    if (!state.hintsEnabled) return false;
    return !state.dismissedHints[hintId];
  }, [state.hintsEnabled, state.dismissedHints]);

  const resetAllHints = useCallback(async () => {
    if (!user) return;

    setState(prev => ({ ...prev, dismissedHints: {} }));

    try {
      await supabase
        .from('profiles')
        .update({ tutorial_completed: {} })
        .eq('user_id', user.id);
    } catch (err) {
      console.error('Error resetting hints:', err);
    }
  }, [user]);

  return {
    hintsEnabled: state.hintsEnabled,
    isLoading,
    dismissHint,
    toggleHints,
    shouldShowHint,
    resetAllHints,
  };
}
