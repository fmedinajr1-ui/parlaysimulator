import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Mail, Lock, Sparkles } from "lucide-react";

interface EmailGateProps {
  letterGrade: string;
  headline: string;
  legCount: number;
  breakdown: Array<{ leg: string; verdict: string; fix?: string }>;
  fixSuggestion: string;
  shareCardId: string;
  onUnlocked: () => void;
}

export function EmailGate({
  letterGrade,
  headline,
  legCount,
  breakdown,
  fixSuggestion,
  shareCardId,
  onUnlocked,
}: EmailGateProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Need a real email");
      return;
    }
    setLoading(true);
    try {
      // Insert subscriber (upsert by email)
      const { data: existing } = await supabase
        .from("email_subscribers")
        .select("id")
        .eq("email", email.toLowerCase())
        .maybeSingle();

      let subscriberId = existing?.id;
      if (!subscriberId) {
        const { data: inserted, error: insertErr } = await supabase
          .from("email_subscribers")
          .insert({
            email: email.toLowerCase(),
            source: "grade",
            drip_day: 0,
            is_subscribed: true,
            metadata: { share_card_id: shareCardId, letter_grade: letterGrade },
          })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        subscriberId = inserted.id;
      }

      // Mark grade event as captured
      await supabase
        .from("grade_events")
        .update({ email_captured: true })
        .eq("share_card_id", shareCardId);

      // Fire welcome email (full breakdown)
      await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "grade-welcome",
          recipientEmail: email.toLowerCase(),
          idempotencyKey: `grade-welcome-${subscriberId}`,
          templateData: {
            letterGrade,
            headline,
            legCount,
            breakdown: breakdown.map((b) => `${b.leg} — ${b.verdict}`),
            fixSuggestion,
          },
        },
      });

      toast.success("Check your inbox — full breakdown sent.");
      onUnlocked();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Something broke. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-background p-6 sm:p-8"
    >
      <div className="flex items-center gap-2 mb-3 text-primary">
        <Lock className="w-4 h-4" />
        <span className="text-xs font-mono uppercase tracking-widest">
          Unlock the breakdown
        </span>
      </div>
      <h3 className="font-display text-2xl sm:text-3xl font-black mb-2">
        Want the full autopsy?
      </h3>
      <p className="text-muted-foreground mb-5 text-sm sm:text-base">
        Get the per-leg breakdown, the fix, and{" "}
        <span className="text-foreground font-semibold">7 days of free picks</span>{" "}
        from the bot — straight to your inbox.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@inbox.com"
            className="pl-10"
            required
          />
        </div>
        <Button type="submit" disabled={loading} variant="neon" className="gap-2">
          <Sparkles className="w-4 h-4" />
          {loading ? "Unlocking..." : "Unlock + 7 free picks"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        One-tap unsubscribe. We won't spam you.
      </p>
    </form>
  );
}
