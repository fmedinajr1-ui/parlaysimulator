import { cn } from "@/lib/utils";
import { TrendingUp, Target, Zap, Flame, Percent } from "lucide-react";

interface EngineDashboardStatsProps {
  totalPicks: number;
  sesPicks: number;
  sharpParlays: number;
  heatParlays: number;
  winRate: number;
}

export function EngineDashboardStats({
  totalPicks,
  sesPicks,
  sharpParlays,
  heatParlays,
  winRate,
}: EngineDashboardStatsProps) {
  const stats = [
    {
      label: "Props Analyzed",
      value: totalPicks,
      icon: <Target className="w-4 h-4" />,
      color: "text-blue-400",
      bgColor: "bg-blue-500/10",
    },
    {
      label: "SES Picks",
      value: sesPicks,
      icon: <TrendingUp className="w-4 h-4" />,
      color: "text-purple-400",
      bgColor: "bg-purple-500/10",
    },
    {
      label: "Sharp Parlays",
      value: sharpParlays,
      icon: <Zap className="w-4 h-4" />,
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
    },
    {
      label: "Heat Parlays",
      value: heatParlays,
      icon: <Flame className="w-4 h-4" />,
      color: "text-orange-400",
      bgColor: "bg-orange-500/10",
    },
    {
      label: "Win Rate (7d)",
      value: `${winRate.toFixed(0)}%`,
      icon: <Percent className="w-4 h-4" />,
      color: winRate >= 55 ? "text-emerald-400" : winRate >= 45 ? "text-amber-400" : "text-red-400",
      bgColor: winRate >= 55 ? "bg-emerald-500/10" : winRate >= 45 ? "bg-amber-500/10" : "bg-red-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-2">
      {stats.map((stat, idx) => (
        <div
          key={idx}
          className={cn(
            "rounded-xl p-3 text-center",
            stat.bgColor,
            "border border-border/30"
          )}
        >
          <div className={cn("flex justify-center mb-1", stat.color)}>
            {stat.icon}
          </div>
          <div className={cn("text-xl font-bold", stat.color)}>
            {stat.value}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
