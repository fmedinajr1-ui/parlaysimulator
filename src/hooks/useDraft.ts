import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { SelectedLeg } from "@/components/manual/ManualParlayPanel";

export interface ParlayDraft {
  id: string;
  share_code: string;
  creator_id: string;
  name: string;
  legs: SelectedLeg[];
  status: "draft" | "finalized";
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface DraftSuggestion {
  id: string;
  draft_id: string;
  user_id: string;
  suggested_leg: SelectedLeg["prop"];
  side: "over" | "under";
  note: string | null;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  username?: string;
}

function generateShareCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function useDraft() {
  const [isLoading, setIsLoading] = useState(false);

  const createDraft = async (name: string, legs: SelectedLeg[]): Promise<string | null> => {
    setIsLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) {
        toast.error("Please sign in to create a shareable draft");
        return null;
      }

      const shareCode = generateShareCode();
      
      const { error } = await supabase
        .from("parlay_drafts")
        .insert([{
          share_code: shareCode,
          creator_id: session.session.user.id,
          name,
          legs: JSON.parse(JSON.stringify(legs)),
        }]);

      if (error) {
        console.error("Error creating draft:", error);
        toast.error("Failed to create draft");
        return null;
      }

      return shareCode;
    } catch (err) {
      console.error("Error:", err);
      toast.error("Something went wrong");
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const getDraft = async (shareCode: string): Promise<ParlayDraft | null> => {
    try {
      const { data, error } = await supabase
        .from("parlay_drafts")
        .select("*")
        .eq("share_code", shareCode)
        .single();

      if (error || !data) {
        return null;
      }

      return {
        ...data,
        legs: (data.legs || []) as unknown as SelectedLeg[],
        status: data.status as "draft" | "finalized",
      };
    } catch {
      return null;
    }
  };

  const updateDraftLegs = async (draftId: string, legs: SelectedLeg[]): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("parlay_drafts")
        .update({ legs: JSON.parse(JSON.stringify(legs)) })
        .eq("id", draftId);

      return !error;
    } catch {
      return false;
    }
  };

  const getSuggestions = async (draftId: string): Promise<DraftSuggestion[]> => {
    try {
      const { data, error } = await supabase
        .from("draft_suggestions")
        .select("*")
        .eq("draft_id", draftId)
        .order("created_at", { ascending: false });

      if (error || !data) return [];

      // Fetch usernames for suggestions
      const userIds = [...new Set(data.map(s => s.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, username")
        .in("user_id", userIds);

      const usernameMap = new Map(profiles?.map(p => [p.user_id, p.username]) || []);

      return data.map(s => ({
        ...s,
        suggested_leg: s.suggested_leg as unknown as SelectedLeg["prop"],
        side: s.side as "over" | "under",
        status: s.status as "pending" | "accepted" | "rejected",
        username: usernameMap.get(s.user_id) || "Anonymous",
      }));
    } catch {
      return [];
    }
  };

  const addSuggestion = async (
    draftId: string,
    leg: SelectedLeg["prop"],
    side: "over" | "under",
    note?: string
  ): Promise<boolean> => {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) {
        toast.error("Please sign in to suggest a leg");
        return false;
      }

      const { error } = await supabase
        .from("draft_suggestions")
        .insert([{
          draft_id: draftId,
          user_id: session.session.user.id,
          suggested_leg: JSON.parse(JSON.stringify(leg)),
          side,
          note: note || null,
        }]);

      if (error) {
        console.error("Error adding suggestion:", error);
        toast.error("Failed to submit suggestion");
        return false;
      }

      toast.success("Suggestion submitted!");
      return true;
    } catch {
      toast.error("Something went wrong");
      return false;
    }
  };

  const updateSuggestionStatus = async (
    suggestionId: string,
    status: "accepted" | "rejected"
  ): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("draft_suggestions")
        .update({ status })
        .eq("id", suggestionId);

      return !error;
    } catch {
      return false;
    }
  };

  return {
    isLoading,
    createDraft,
    getDraft,
    updateDraftLegs,
    getSuggestions,
    addSuggestion,
    updateSuggestionStatus,
  };
}
