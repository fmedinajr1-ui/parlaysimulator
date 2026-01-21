import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check, Share2, Link2, Loader2 } from "lucide-react";
import { useDraft } from "@/hooks/useDraft";
import { toast } from "sonner";
import type { SelectedLeg } from "@/components/manual/ManualParlayPanel";

interface ShareDraftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legs: SelectedLeg[];
  onDraftCreated?: (shareCode: string) => void;
}

export function ShareDraftModal({ open, onOpenChange, legs, onDraftCreated }: ShareDraftModalProps) {
  const [name, setName] = useState("");
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { createDraft, isLoading } = useDraft();

  const shareUrl = shareCode 
    ? `${window.location.origin}/draft/${shareCode}` 
    : "";

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Please enter a name for your draft");
      return;
    }

    const code = await createDraft(name, legs);
    if (code) {
      setShareCode(code);
      onDraftCreated?.(code);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: name,
          text: `Help me build this parlay! ${legs.length} legs so far.`,
          url: shareUrl,
        });
      } catch {
        // User cancelled
      }
    } else {
      handleCopy();
    }
  };

  const handleClose = () => {
    setName("");
    setShareCode(null);
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-primary" />
            {shareCode ? "Share Your Draft" : "Create Shareable Draft"}
          </DialogTitle>
          <DialogDescription>
            {shareCode 
              ? "Send this link to friends so they can suggest legs for your parlay."
              : "Create a collaborative draft that friends can view and add suggestions to."
            }
          </DialogDescription>
        </DialogHeader>

        {!shareCode ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="draft-name">Draft Name</Label>
              <Input
                id="draft-name"
                placeholder="e.g., Tonight's NBA picks"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
              />
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-sm">
              <p className="text-muted-foreground">
                Your draft has <span className="font-semibold text-foreground">{legs.length} leg{legs.length !== 1 ? "s" : ""}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Friends can view and suggest additional legs
              </p>
            </div>

            <Button 
              onClick={handleCreate} 
              className="w-full" 
              disabled={isLoading || !name.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 mr-2" />
                  Create Draft Link
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <Input
                value={shareUrl}
                readOnly
                className="font-mono text-sm"
              />
              <Button 
                variant="outline" 
                size="icon"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-accent" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleCopy} variant="outline" className="flex-1">
                <Copy className="w-4 h-4 mr-2" />
                Copy Link
              </Button>
              <Button onClick={handleShare} className="flex-1">
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Link expires in 7 days
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
