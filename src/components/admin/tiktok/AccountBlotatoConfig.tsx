// @ts-nocheck
// Phase 6 — Per-account Blotato auto-posting configuration.
// Lets admin paste the Blotato accountId for each persona and toggle auto-post.

import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Zap } from "lucide-react";

export default function AccountBlotatoConfig({
  account,
  onSaved,
}: {
  account: any;
  onSaved: () => void | Promise<void>;
}) {
  const [blotatoId, setBlotatoId] = useState<string>(account.blotato_account_id || "");
  const [enabled, setEnabled] = useState<boolean>(!!account.auto_post_enabled);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tiktok_accounts")
        .update({
          blotato_account_id: blotatoId.trim() || null,
          auto_post_enabled: enabled && !!blotatoId.trim(),
        })
        .eq("id", account.id);
      if (error) throw error;
      toast.success("Blotato config saved");
      await onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t mt-3 pt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Zap className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase text-muted-foreground">Blotato auto-post</span>
        {account.auto_post_enabled && account.blotato_account_id ? (
          <Badge variant="default" className="text-[10px]">Enabled</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">Disabled</Badge>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div>
          <Label htmlFor={`blot-${account.id}`} className="text-xs">Blotato Account ID</Label>
          <Input
            id={`blot-${account.id}`}
            value={blotatoId}
            placeholder="e.g. acc_abc123"
            onChange={(e) => setBlotatoId(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 pb-1">
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!blotatoId.trim()} />
          <span className="text-xs">Auto-post</span>
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Get the account ID from Blotato dashboard → Connected Accounts → TikTok ({account.persona_key}).
      </p>
    </div>
  );
}