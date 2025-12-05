import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useSharpFollow(movementId: string) {
  const { user } = useAuth();
  const [isFollowed, setIsFollowed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (user && movementId) {
      checkIfFollowed();
    }
  }, [user, movementId]);

  const checkIfFollowed = async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from('user_sharp_follows')
      .select('id')
      .eq('user_id', user.id)
      .eq('line_movement_id', movementId)
      .maybeSingle();

    if (!error && data) {
      setIsFollowed(true);
    }
  };

  const toggleFollow = useCallback(async () => {
    if (!user) {
      toast.error("Sign in to track picks");
      return;
    }

    setIsLoading(true);
    
    try {
      if (isFollowed) {
        // Unfollow
        const { error } = await supabase
          .from('user_sharp_follows')
          .delete()
          .eq('user_id', user.id)
          .eq('line_movement_id', movementId);

        if (error) throw error;
        setIsFollowed(false);
        toast.success("Pick removed from your record");
      } else {
        // Follow
        const { error } = await supabase
          .from('user_sharp_follows')
          .insert({
            user_id: user.id,
            line_movement_id: movementId,
          });

        if (error) throw error;
        setIsFollowed(true);
        toast.success("Pick added to your record");
      }
    } catch (error: any) {
      console.error('Error toggling follow:', error);
      toast.error(error.message || "Failed to update");
    } finally {
      setIsLoading(false);
    }
  }, [user, movementId, isFollowed]);

  return { isFollowed, isLoading, toggleFollow };
}
