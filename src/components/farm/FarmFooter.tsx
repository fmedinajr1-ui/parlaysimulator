const BLOG_LINKS: { label: string; href: string }[] = [
  { label: "All Articles", href: "/blog" },
  { label: "Strategy", href: "/blog/category/strategy" },
  { label: "AI Picks", href: "/blog/category/ai-picks" },
  { label: "NBA", href: "/blog/category/nba" },
  { label: "Prop Analysis", href: "/blog/category/prop-analysis" },
  { label: "MLB", href: "/blog/category/mlb" },
  { label: "MMA", href: "/blog/category/mma" },
  { label: "Tennis", href: "/blog/category/tennis" },
];

export function FarmFooter() {
  return (
    <footer className="border-t border-[hsl(var(--farm-line))] py-10 px-5 text-xs text-[hsl(var(--farm-muted))]">
      <div className="max-w-6xl mx-auto">
        <div className="grid gap-8 md:grid-cols-2 mb-8 text-left">
          <div>
            <div className="farm-display text-base text-[hsl(var(--farm-text))] mb-2">ParlayFarm 🐕</div>
            <p className="opacity-80 max-w-md">
              AI-powered sports betting analysis, sharp money tracking, and daily parlay insights.
            </p>
          </div>
          <div>
            <div className="farm-display text-sm text-[hsl(var(--farm-text))] mb-3">Read the Blog</div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
              {BLOG_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="hover:text-[hsl(var(--farm-text))]">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="text-center space-y-2 border-t border-[hsl(var(--farm-line))] pt-6">
          <p>For entertainment & informational purposes only. <strong>21+ only.</strong> If you or someone you know has a gambling problem, call <strong>1-800-GAMBLER</strong>.</p>
          <p className="opacity-70">© {new Date().getFullYear()} ParlayFarm. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
