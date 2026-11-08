import type { RestProfile } from "@/utils/restProfile";

export function RestBadge({ rest, className = "" }: { rest: RestProfile; className?: string }) {
  const tone = rest.status === "back-to-back"
    ? "bg-[hsl(var(--desk-loss)/0.14)] text-[hsl(var(--desk-loss))]"
    : rest.status === "rested" || rest.status === "well-rested"
      ? "bg-[hsl(var(--desk-win)/0.14)] text-[hsl(var(--desk-win))]"
      : "bg-[hsl(var(--desk-line)/0.65)] text-[hsl(var(--desk-muted))]";
  return (
    <span
      className={`desk-mono inline-flex shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-bold ${tone} ${className}`}
      title={rest.explanation}
      aria-label={`Rest status: ${rest.label}. ${rest.explanation}`}
    >
      {rest.label}
    </span>
  );
}
