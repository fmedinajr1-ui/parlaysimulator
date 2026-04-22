import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { SweetSpotFunnelMode } from "@/types/sweetSpot";

const STORAGE_KEY = "sweet-spot-funnel-mode";
const DEFAULT_MODE: SweetSpotFunnelMode = "core";

function readLocalMode(): SweetSpotFunnelMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "aggressive" ? "aggressive" : "core";
}

export function useSweetSpotFunnelPreference() {
  const { user } = useAuth();
  const [funnelMode, setFunnelModeState] = useState<SweetSpotFunnelMode>(() => readLocalMode());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadPreference = async () => {
      if (!user) {
        if (!cancelled) {
          setFunnelModeState(readLocalMode());
          setIsLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from("sweet_spot_preferences")
          .select("funnel_mode")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;

        const nextMode = data?.funnel_mode === "aggressive" ? "aggressive" : readLocalMode();
        if (!cancelled) {
          setFunnelModeState(nextMode);
          window.localStorage.setItem(STORAGE_KEY, nextMode);
        }
      } catch (error) {
        console.error("[SweetSpotPreference] Failed to load funnel mode:", error);
        if (!cancelled) {
          setFunnelModeState(readLocalMode());
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPreference();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const setFunnelMode = useCallback(
    async (nextMode: SweetSpotFunnelMode) => {
      setFunnelModeState(nextMode);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, nextMode);
      }

      if (!user) {
        return { success: true, persisted: "local" as const };
      }

      setIsSaving(true);
      try {
        const { error } = await supabase.from("sweet_spot_preferences").upsert(
          {
            user_id: user.id,
            funnel_mode: nextMode,
          },
          { onConflict: "user_id" },
        );

        if (error) throw error;

        await supabase.functions.invoke("sweet-spot-telegram-sync", {
          body: {
            funnelMode: nextMode,
            source: "app-toggle",
            notifyAdmin: true,
          },
        });

        return { success: true, persisted: "cloud" as const };
      } catch (error) {
        console.error("[SweetSpotPreference] Failed to save funnel mode:", error);
        return { success: false, persisted: "local" as const, error };
      } finally {
        setIsSaving(false);
      }
    },
    [user],
  );

  return useMemo(
    () => ({
      funnelMode,
      setFunnelMode,
      isLoading,
      isSaving,
    }),
    [funnelMode, isLoading, isSaving, setFunnelMode],
  );
}