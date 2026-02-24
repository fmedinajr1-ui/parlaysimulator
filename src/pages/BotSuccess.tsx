import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Copy, ExternalLink, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const TELEGRAM_BOT_URL = "https://t.me/parlayiqbot";

const BotSuccess = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [password, setPassword] = useState<string | null>(null);
  const [alreadyRetrieved, setAlreadyRetrieved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!sessionId) {
      setError("Missing session ID");
      setLoading(false);
      return;
    }

    const fetchPassword = async () => {
      try {
        const { data, error: fnError } = await supabase.functions.invoke("retrieve-bot-password", {
          body: { session_id: sessionId },
        });

        if (fnError) throw new Error(fnError.message);
        if (data.error) throw new Error(data.error);

        if (data.already_retrieved) {
          setAlreadyRetrieved(true);
        } else {
          setPassword(data.password);
        }
      } catch (err: any) {
        setError(err.message || "Failed to retrieve password");
      } finally {
        setLoading(false);
      }
    };

    fetchPassword();
  }, [sessionId]);

  const copyPassword = () => {
    if (password) {
      navigator.clipboard.writeText(`/start ${password}`);
      toast({ title: "Copied!", description: "Command copied to clipboard" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        {loading ? (
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Retrieving your access code...</p>
          </div>
        ) : error ? (
          <div className="text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
            <p className="text-muted-foreground">{error}</p>
          </div>
        ) : alreadyRetrieved ? (
          <div className="text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
            <h1 className="text-xl font-bold text-foreground">Password Already Shown</h1>
            <p className="text-muted-foreground">
              Your one-time password was already displayed. If you didn't save it, please contact support for assistance.
            </p>
          </div>
        ) : (
          <div className="text-center space-y-6">
            <CheckCircle2 className="h-16 w-16 text-primary mx-auto" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Payment Successful!</h1>
              <p className="text-muted-foreground mt-1">Your ParlayIQ Bot access is ready</p>
            </div>

            <div className="bg-card border border-border rounded-lg p-6 space-y-3">
              <p className="text-sm text-muted-foreground font-medium">Your one-time access code:</p>
              <div className="flex items-center justify-center gap-2">
                <code className="text-2xl font-mono font-bold text-primary tracking-wider">
                  {password}
                </code>
                <Button variant="ghost" size="icon" onClick={copyPassword} className="shrink-0">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4 text-left space-y-2">
              <p className="text-sm font-semibold text-foreground">How to activate:</p>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Open <strong>@parlayiqbot</strong> on Telegram</li>
                <li>
                  Send: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">/start {password}</code>
                </li>
                <li>You're in! Daily picks will start flowing</li>
              </ol>
            </div>

            <Button asChild className="w-full" size="lg">
              <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
                Open ParlayIQ Bot <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>

            <p className="text-xs text-destructive/80 flex items-center justify-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              This password will only be shown once and works for one person only.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BotSuccess;
