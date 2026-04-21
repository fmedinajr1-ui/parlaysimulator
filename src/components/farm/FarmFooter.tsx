export function FarmFooter() {
  return (
    <footer className="border-t border-[hsl(var(--farm-line))] py-10 px-5 text-center text-xs text-[hsl(var(--farm-muted))]">
      <div className="max-w-6xl mx-auto space-y-2">
        <div className="farm-display text-base text-[hsl(var(--farm-text))]">ParlayFarm 🐕</div>
        <p>For entertainment & informational purposes only. <strong>21+ only.</strong> If you or someone you know has a gambling problem, call <strong>1-800-GAMBLER</strong>.</p>
        <p className="opacity-70">© {new Date().getFullYear()} ParlayFarm. All rights reserved.</p>
      </div>
    </footer>
  );
}
