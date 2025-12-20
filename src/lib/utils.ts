import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ShareOptions {
  title: string;
  text: string;
  url: string;
}

export const shareContent = async (options: ShareOptions): Promise<boolean> => {
  if (navigator.share) {
    try {
      await navigator.share(options);
      return true;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        await navigator.clipboard.writeText(options.url);
        return false;
      }
      return true;
    }
  } else {
    await navigator.clipboard.writeText(options.url);
    return false;
  }
};
