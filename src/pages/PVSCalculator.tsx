import { AppShell } from "@/components/layout/AppShell";
import { PVSPropCalculator } from "@/components/props/PVSPropCalculator";

export default function PVSCalculator() {
  return (
    <AppShell>

      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <PVSPropCalculator />
      </div>
    </AppShell>
  );
}
