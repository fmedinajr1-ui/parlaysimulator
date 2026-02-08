/**
 * BotNotificationSettings.tsx
 * 
 * Manage Telegram notification preferences for the bot.
 */

import React, { useState } from 'react';
import { Send, Bell, BellOff, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface NotificationSettings {
  id?: string;
  telegram_enabled: boolean;
  notify_parlays_generated: boolean;
  notify_settlement: boolean;
  notify_activation_ready: boolean;
  notify_weight_changes: boolean;
  notify_strategy_updates: boolean;
  quiet_start_hour: number;
  quiet_end_hour: number;
}

const defaultSettings: NotificationSettings = {
  telegram_enabled: true,
  notify_parlays_generated: true,
  notify_settlement: true,
  notify_activation_ready: true,
  notify_weight_changes: false,
  notify_strategy_updates: false,
  quiet_start_hour: 23,
  quiet_end_hour: 7,
};

export function BotNotificationSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isTesting, setIsTesting] = useState(false);

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['bot-notification-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_notification_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return (data as NotificationSettings) || defaultSettings;
    },
  });

  // Update settings mutation
  const updateMutation = useMutation({
    mutationFn: async (newSettings: Partial<NotificationSettings>) => {
      const current = settings || defaultSettings;
      const updated = { ...current, ...newSettings, updated_at: new Date().toISOString() };

      if (current.id) {
        const { error } = await supabase
          .from('bot_notification_settings')
          .update(updated)
          .eq('id', current.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('bot_notification_settings')
          .insert(updated);
        if (error) throw error;
      }
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-notification-settings'] });
      toast({ title: 'Settings saved' });
    },
    onError: (error) => {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    },
  });

  // Test notification
  const handleTestNotification = async () => {
    setIsTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('bot-send-telegram', {
        body: { type: 'test', data: {} },
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: '✅ Test Sent!',
          description: 'Check your Telegram for the message.',
        });
      } else if (data?.skipped) {
        toast({
          title: 'Skipped',
          description: `Notification skipped: ${data.reason}`,
        });
      } else {
        throw new Error(data?.error || 'Unknown error');
      }
    } catch (error) {
      toast({
        title: 'Test Failed',
        description: error instanceof Error ? error.message : 'Could not send test',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleToggle = (key: keyof NotificationSettings, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const currentSettings = settings || defaultSettings;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" />
              Telegram Notifications
            </CardTitle>
            <CardDescription>
              Get instant updates on your phone
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {currentSettings.telegram_enabled ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-muted-foreground" />
            )}
            <span className="text-sm">
              {currentSettings.telegram_enabled ? 'Connected' : 'Disabled'}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Master toggle */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            {currentSettings.telegram_enabled ? (
              <Bell className="w-4 h-4 text-primary" />
            ) : (
              <BellOff className="w-4 h-4 text-muted-foreground" />
            )}
            <Label htmlFor="telegram-enabled" className="font-medium">
              Enable Notifications
            </Label>
          </div>
          <Switch
            id="telegram-enabled"
            checked={currentSettings.telegram_enabled}
            onCheckedChange={(checked) => handleToggle('telegram_enabled', checked)}
          />
        </div>

        <div className="border-t border-border/50 pt-4 space-y-3">
          {/* Notification types */}
          <div className="flex items-center justify-between">
            <Label htmlFor="notify-parlays" className="text-sm">
              Parlay Generation (9 AM ET)
            </Label>
            <Switch
              id="notify-parlays"
              checked={currentSettings.notify_parlays_generated}
              onCheckedChange={(checked) => handleToggle('notify_parlays_generated', checked)}
              disabled={!currentSettings.telegram_enabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="notify-settlement" className="text-sm">
              Settlement Reports (6 AM ET)
            </Label>
            <Switch
              id="notify-settlement"
              checked={currentSettings.notify_settlement}
              onCheckedChange={(checked) => handleToggle('notify_settlement', checked)}
              disabled={!currentSettings.telegram_enabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="notify-activation" className="text-sm">
              Activation Alerts
            </Label>
            <Switch
              id="notify-activation"
              checked={currentSettings.notify_activation_ready}
              onCheckedChange={(checked) => handleToggle('notify_activation_ready', checked)}
              disabled={!currentSettings.telegram_enabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="notify-weights" className="text-sm text-muted-foreground">
              Category Weight Changes
            </Label>
            <Switch
              id="notify-weights"
              checked={currentSettings.notify_weight_changes}
              onCheckedChange={(checked) => handleToggle('notify_weight_changes', checked)}
              disabled={!currentSettings.telegram_enabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="notify-strategy" className="text-sm text-muted-foreground">
              Strategy Updates
            </Label>
            <Switch
              id="notify-strategy"
              checked={currentSettings.notify_strategy_updates}
              onCheckedChange={(checked) => handleToggle('notify_strategy_updates', checked)}
              disabled={!currentSettings.telegram_enabled}
            />
          </div>
        </div>

        {/* Quiet hours info */}
        <div className="text-xs text-muted-foreground pt-2 border-t border-border/50">
          Quiet Hours: {currentSettings.quiet_start_hour}:00 - {currentSettings.quiet_end_hour}:00 ET
        </div>

        {/* Test button */}
        <Button
          variant="outline"
          className="w-full"
          onClick={handleTestNotification}
          disabled={isTesting || !currentSettings.telegram_enabled}
        >
          {isTesting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          Send Test Notification
        </Button>
      </CardContent>
    </Card>
  );
}
