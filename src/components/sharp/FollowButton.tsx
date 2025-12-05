import { Button } from "@/components/ui/button";
import { useSharpFollow } from "@/hooks/useSharpFollow";
import { BookmarkPlus, BookmarkCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FollowButtonProps {
  movementId: string;
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
}

export function FollowButton({ movementId, className, size = "sm" }: FollowButtonProps) {
  const { isFollowed, isLoading, toggleFollow } = useSharpFollow(movementId);

  return (
    <Button
      variant={isFollowed ? "secondary" : "outline"}
      size={size}
      onClick={(e) => {
        e.stopPropagation();
        toggleFollow();
      }}
      disabled={isLoading}
      className={cn(
        "transition-all",
        isFollowed && "bg-primary/20 border-primary/50 text-primary",
        className
      )}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isFollowed ? (
        <>
          <BookmarkCheck className="w-4 h-4 mr-1" />
          Following
        </>
      ) : (
        <>
          <BookmarkPlus className="w-4 h-4 mr-1" />
          Follow
        </>
      )}
    </Button>
  );
}
