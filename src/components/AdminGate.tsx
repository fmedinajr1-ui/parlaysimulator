import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KEY = "desk_unlocked_v1";
export const PASS_KEY = "desk_passcode_v1";

/** Passcode gate for the private desk. The passcode is checked on the server. */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(KEY) === "1" && !!localStorage.getItem(PASS_KEY));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (unlocked) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await supabase.functions.invoke("desk-passcode", { body: { passcode: code } });
      if (data?.ok) {
        localStorage.setItem(KEY, "1");
        localStorage.setItem(PASS_KEY, code);
        setUnlocked(true);
      } else setError("Wrong passcode");
    } catch {
      setError("Couldn't check passcode, try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-3">
        <h1 className="text-lg font-semibold text-foreground text-center">Enter passcode</h1>
        <Input type="password" inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Passcode" />
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !code}>{busy ? "Checking…" : "Unlock"}</Button>
      </form>
    </div>
  );
}
