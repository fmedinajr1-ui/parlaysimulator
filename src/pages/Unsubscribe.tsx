import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, MailX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type State =
  | { kind: "loading" }
  | { kind: "valid" }
  | { kind: "invalid" }
  | { kind: "already" }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid" });
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON } }
        );
        const data = await res.json();
        if (!res.ok) {
          setState({ kind: "invalid" });
          return;
        }
        if (data.valid === false && data.reason === "already_unsubscribed") {
          setState({ kind: "already" });
          return;
        }
        if (data.valid === true) {
          setState({ kind: "valid" });
          return;
        }
        setState({ kind: "invalid" });
      } catch (err: any) {
        setState({ kind: "error", message: err?.message ?? "Network error" });
      }
    })();
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setState({ kind: "submitting" });
    try {
      const { data, error } = await supabase.functions.invoke(
        "handle-email-unsubscribe",
        { body: { token } }
      );
      if (error) throw error;
      if (data?.success || data?.reason === "already_unsubscribed") {
        setState({ kind: "done" });
      } else {
        setState({ kind: "error", message: "Could not unsubscribe." });
      }
    } catch (err: any) {
      setState({ kind: "error", message: err?.message ?? "Failed" });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="flex items-center gap-3">
          <MailX className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Unsubscribe</h1>
        </div>

        {state.kind === "loading" && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Checking your link…</span>
          </div>
        )}

        {state.kind === "invalid" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              <span className="font-semibold">Invalid or expired link</span>
            </div>
            <p className="text-sm text-muted-foreground">
              This unsubscribe link is no longer valid. If you keep getting emails you
              didn't sign up for, just reply to one and we'll remove you manually.
            </p>
          </div>
        )}

        {state.kind === "already" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-foreground">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-semibold">You're already unsubscribed</span>
            </div>
            <p className="text-sm text-muted-foreground">
              No further emails will be sent to this address.
            </p>
          </div>
        )}

        {state.kind === "valid" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Click the button below to stop receiving emails from ParlayFarm.
            </p>
            <Button onClick={confirm} variant="destructive" className="w-full">
              Confirm Unsubscribe
            </Button>
          </div>
        )}

        {state.kind === "submitting" && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Unsubscribing…</span>
          </div>
        )}

        {state.kind === "done" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-foreground">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-semibold">You're unsubscribed</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Sorry to see you go. You can come back anytime at parlayfarm.com.
            </p>
          </div>
        )}

        {state.kind === "error" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              <span className="font-semibold">Something went wrong</span>
            </div>
            <p className="text-sm text-muted-foreground">{state.message}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
