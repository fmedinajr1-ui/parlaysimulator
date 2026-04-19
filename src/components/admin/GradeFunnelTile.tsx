import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { GraduationCap, Mail, Send, TrendingUp } from "lucide-react";

interface Stats {
  gradesToday: number;
  emailsCaptured: number;
  activeDrips: number;
  paidConversions: number;
}

export function GradeFunnelTile() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ count: gradesToday }, { count: emailsCaptured }, { count: activeDrips }, { count: paidConversions }] =
        await Promise.all([
          supabase
            .from("grade_events")
            .select("*", { count: "exact", head: true })
            .gte("created_at", `${today}T00:00:00Z`),
          supabase
            .from("email_subscribers")
            .select("*", { count: "exact", head: true })
            .eq("source", "grade"),
          supabase
            .from("email_subscribers")
            .select("*", { count: "exact", head: true })
            .eq("source", "grade")
            .lt("drip_day", 7)
            .eq("drip_paused", false)
            .is("unsubscribed_at", null),
          supabase
            .from("email_subscribers")
            .select("*", { count: "exact", head: true })
            .eq("source", "grade")
            .eq("converted_to_paid", true),
        ]);

      setStats({
        gradesToday: gradesToday ?? 0,
        emailsCaptured: emailsCaptured ?? 0,
        activeDrips: activeDrips ?? 0,
        paidConversions: paidConversions ?? 0,
      });
    })();
  }, []);

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <GraduationCap className="w-5 h-5 text-primary" />
        <h3 className="font-display text-lg font-bold">Free Slip Grader Funnel</h3>
      </div>
      {!stats ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={GraduationCap} label="Grades today" value={stats.gradesToday} />
          <Stat icon={Mail} label="Emails captured" value={stats.emailsCaptured} />
          <Stat icon={Send} label="Active drips" value={stats.activeDrips} />
          <Stat icon={TrendingUp} label="Paid conversions" value={stats.paidConversions} accent />
        </div>
      )}
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className={`p-3 rounded-lg border ${accent ? "bg-primary/10 border-primary/30" : "bg-muted/40"}`}>
      <Icon className={`w-4 h-4 mb-1 ${accent ? "text-primary" : "text-muted-foreground"}`} />
      <div className="text-2xl font-display font-black">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
