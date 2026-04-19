import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Download, Twitter, Share2 } from "lucide-react";
import { toast } from "sonner";

interface ShareCardProps {
  letterGrade: string;
  headline: string;
  legCount: number;
  shareCardId: string;
}

const GRADE_BG: Record<string, string> = {
  A: "linear-gradient(135deg,#064e3b 0%,#0a0a0a 100%)",
  B: "linear-gradient(135deg,#365314 0%,#0a0a0a 100%)",
  C: "linear-gradient(135deg,#78350f 0%,#0a0a0a 100%)",
  D: "linear-gradient(135deg,#7c2d12 0%,#0a0a0a 100%)",
  F: "linear-gradient(135deg,#7f1d1d 0%,#0a0a0a 100%)",
};

const GRADE_COLOR: Record<string, string> = {
  A: "#22c55e", B: "#84cc16", C: "#eab308", D: "#f97316", F: "#ef4444",
};

export function ShareCard({ letterGrade, headline, legCount, shareCardId }: ShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const renderToCanvas = async (): Promise<HTMLCanvasElement> => {
    const html2canvas = (await import("html2canvas")).default;
    return await html2canvas(cardRef.current!, {
      backgroundColor: null,
      scale: 2,
      logging: false,
      useCORS: true,
    });
  };

  const handleDownload = async () => {
    try {
      const canvas = await renderToCanvas();
      const link = document.createElement("a");
      link.download = `parlayfarm-grade-${letterGrade}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("Saved to your downloads.");
    } catch {
      toast.error("Couldn't generate image. Try again.");
    }
  };

  const handleTweet = () => {
    const text = encodeURIComponent(
      `My parlay just got a ${letterGrade} from @parlayfarm 💀\n\n"${headline}"\n\nGrade yours free → parlayfarm.com/grade`
    );
    window.open(`https://twitter.com/intent/tweet?text=${text}`, "_blank");
  };

  const handleShare = async () => {
    if (!navigator.share) {
      handleDownload();
      return;
    }
    try {
      const canvas = await renderToCanvas();
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `grade-${letterGrade}.png`, { type: "image/png" });
        await navigator.share({
          files: [file],
          title: `My parlay got a ${letterGrade}`,
          text: headline,
        });
      });
    } catch {
      handleDownload();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <div
          ref={cardRef}
          style={{
            width: "600px",
            height: "315px",
            background: GRADE_BG[letterGrade] || GRADE_BG.C,
            color: "#fff",
            padding: "32px",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif",
            transform: "scale(0.8)",
            transformOrigin: "top center",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "11px", letterSpacing: "2px", opacity: 0.6, fontWeight: 700 }}>
                PARLAYFARM SLIP GRADER
              </div>
              <div style={{ fontSize: "13px", opacity: 0.7, marginTop: "4px" }}>
                {legCount}-leg parlay · graded
              </div>
            </div>
            <div
              style={{
                fontSize: "120px",
                fontWeight: 900,
                color: GRADE_COLOR[letterGrade] || "#eab308",
                lineHeight: 0.85,
              }}
            >
              {letterGrade}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "20px", fontWeight: 700, fontStyle: "italic", lineHeight: 1.3 }}>
              "{headline}"
            </div>
            <div style={{ fontSize: "12px", opacity: 0.6, marginTop: "12px", letterSpacing: "1px" }}>
              GRADE YOURS FREE → PARLAYFARM.COM/GRADE
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        <Button onClick={handleDownload} variant="outline" size="sm" className="gap-2">
          <Download className="w-4 h-4" /> Download PNG
        </Button>
        <Button onClick={handleTweet} variant="outline" size="sm" className="gap-2">
          <Twitter className="w-4 h-4" /> Tweet this
        </Button>
        <Button onClick={handleShare} variant="neon" size="sm" className="gap-2">
          <Share2 className="w-4 h-4" /> Share
        </Button>
      </div>
    </div>
  );
}
