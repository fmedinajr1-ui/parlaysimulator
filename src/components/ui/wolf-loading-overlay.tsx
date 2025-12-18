import { WolfLoader } from "./wolf-loader";

interface WolfLoadingOverlayProps {
  text?: string;
}

export function WolfLoadingOverlay({ text = "Loading..." }: WolfLoadingOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <WolfLoader size="xl" text={text} />
    </div>
  );
}
