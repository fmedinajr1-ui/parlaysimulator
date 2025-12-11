// Tutorial hook - manages tutorial state and completion
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

type TutorialPage = 'compare' | 'upload' | 'suggestions' | 'profile' | 'odds';

interface TutorialCompleted {
  [key: string]: boolean;
}

export function useTutorial(page: TutorialPage) {
  const { user } = useAuth();
  const [showTutorial, setShowTutorial] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [tutorialCompleted, setTutorialCompleted] = useState<TutorialCompleted>({});

  // Check if tutorial is needed
  useEffect(() => {
    const checkTutorial = async () => {
      console.log('[Tutorial] Checking tutorial for page:', page, 'user:', user?.id);
      
      if (!user) {
        console.log('[Tutorial] No user, skipping tutorial check');
        setIsLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('tutorial_completed')
          .eq('user_id', user.id)
          .single();

        console.log('[Tutorial] Profile data:', data, 'error:', error);

        if (error) {
          console.error('Error fetching tutorial status:', error);
          // If no profile exists, show tutorial anyway
          if (error.code === 'PGRST116') {
            console.log('[Tutorial] No profile found, showing tutorial');
            setTimeout(() => setShowTutorial(true), 500);
          }
          setIsLoading(false);
          return;
        }

        const completed = (data?.tutorial_completed as TutorialCompleted) || {};
        setTutorialCompleted(completed);
        
        console.log('[Tutorial] Tutorial completed status:', completed, 'page completed:', completed[page]);
        
        // Show tutorial if not completed for this page
        if (!completed[page]) {
          console.log('[Tutorial] Showing tutorial for page:', page);
          setTimeout(() => setShowTutorial(true), 500);
        }
      } catch (err) {
        console.error('Tutorial check error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    checkTutorial();
  }, [user, page]);

  const markComplete = useCallback(async () => {
    if (!user) return;

    const newCompleted = { ...tutorialCompleted, [page]: true };
    setTutorialCompleted(newCompleted);
    setShowTutorial(false);

    try {
      await supabase
        .from('profiles')
        .update({ tutorial_completed: newCompleted })
        .eq('user_id', user.id);
    } catch (err) {
      console.error('Error saving tutorial completion:', err);
    }
  }, [user, page, tutorialCompleted]);

  const resetTutorial = useCallback(async () => {
    if (!user) return;

    const newCompleted = { ...tutorialCompleted, [page]: false };
    setTutorialCompleted(newCompleted);

    try {
      await supabase
        .from('profiles')
        .update({ tutorial_completed: newCompleted })
        .eq('user_id', user.id);
    } catch (err) {
      console.error('Error resetting tutorial:', err);
    }
  }, [user, page, tutorialCompleted]);

  return {
    showTutorial,
    setShowTutorial,
    isLoading,
    markComplete,
    resetTutorial,
    isCompleted: tutorialCompleted[page] ?? false,
  };
}
