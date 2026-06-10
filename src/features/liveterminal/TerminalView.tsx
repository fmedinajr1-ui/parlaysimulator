import type { LiveGameState } from "@/features/live3d/types";
import { PitchPanel } from "./PitchPanel";
import { TerminalPanels } from "./panels";

export function TerminalView({ state }: { state: LiveGameState }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex-1 min-h-[360px]">
        <PitchPanel state={state} />
      </div>
      <TerminalPanels state={state} />
    </div>
  );
}