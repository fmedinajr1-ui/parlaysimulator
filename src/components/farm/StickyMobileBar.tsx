interface Props {
  onJoin: () => void;
  onUpload: () => void;
}

export function StickyMobileBar({ onJoin, onUpload }: Props) {
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 backdrop-blur-md bg-[hsl(var(--farm-bg)/0.92)] border-t border-[hsl(var(--farm-line))] p-3 pb-safe flex gap-2">
      <button onClick={onUpload} className="farm-btn-ghost flex-1 text-sm py-3">📤 Free Slip</button>
      <button onClick={onJoin} className="farm-btn-primary flex-1 text-sm py-3">🐕 Join the Farm</button>
    </div>
  );
}
