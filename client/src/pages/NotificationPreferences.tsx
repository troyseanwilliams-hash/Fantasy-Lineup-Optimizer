import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Bell, Mail, Smartphone, AlertTriangle, Trophy, Clock, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { usePageMeta } from "@/hooks/use-page-meta";

interface NotifPrefs {
  emailEnabled: boolean;
  smsEnabled: boolean;
  phoneNumber: string | null;
  injuryAlerts: boolean;
  scoringMilestones: boolean;
  preGameReminders: boolean;
  preGameMinutes: number;
}

export default function NotificationPreferences() {
  usePageMeta({ title: "Notification Preferences", description: "Configure your alert preferences for lineup updates and player news.", path: "/notifications" });
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const { data: prefs, isLoading } = useQuery<NotifPrefs>({
    queryKey: ["/api/notification-preferences"],
    enabled: !!user,
  });

  const form = useForm<NotifPrefs>({
    defaultValues: {
      emailEnabled: true,
      smsEnabled: false,
      phoneNumber: null,
      injuryAlerts: true,
      scoringMilestones: true,
      preGameReminders: true,
      preGameMinutes: 60,
    },
  });

  useEffect(() => {
    if (prefs) {
      form.reset(prefs);
    }
  }, [prefs]);

  const mutation = useMutation({
    mutationFn: async (data: NotifPrefs) => {
      const res = await apiRequest("PUT", "/api/notification-preferences", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      toast({ title: "Preferences saved", description: "Your notification preferences have been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save preferences.", variant: "destructive" });
    },
  });

  const tier = subData?.tier || "free";
  const isPaid = tier === "star" || tier === "pro";

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center" data-testid="notif-prefs-login-required">
        <Card className="bg-slate-900 border-slate-700 max-w-md">
          <CardContent className="p-8 text-center">
            <Bell className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sign In Required</h2>
            <p className="text-slate-400">Log in to manage your notification preferences.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isPaid && !user.isAdmin) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center" data-testid="notif-prefs-upgrade">
        <Card className="bg-slate-900 border-slate-700 max-w-md">
          <CardContent className="p-8 text-center">
            <Bell className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sharpshooter+ Required</h2>
            <p className="text-slate-400 mb-4">Upgrade to manage notification preferences.</p>
            <Button onClick={() => window.location.href = "/pricing"} className="bg-emerald-600 hover:bg-emerald-700" data-testid="btn-upgrade-notif">
              View Plans
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const onSubmit = form.handleSubmit((data) => {
    mutation.mutate(data);
  });

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-3 mb-6" data-testid="notif-prefs-title">
          <Bell className="w-7 h-7 text-emerald-500" />
          Notification Preferences
        </h1>

        <form onSubmit={onSubmit} className="space-y-6">
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <Mail className="w-5 h-5 text-blue-400" />
                Delivery Channels
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between" data-testid="toggle-email">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-slate-400" />
                  <div>
                    <Label className="text-white font-bold">Email Notifications</Label>
                    <p className="text-xs text-slate-400">Receive alerts via email</p>
                  </div>
                </div>
                <Switch
                  checked={form.watch("emailEnabled")}
                  onCheckedChange={(v) => form.setValue("emailEnabled", v)}
                  data-testid="switch-email"
                />
              </div>

              <div className="flex items-center justify-between" data-testid="toggle-sms">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-5 h-5 text-slate-400" />
                  <div>
                    <Label className="text-white font-bold">SMS Notifications</Label>
                    <p className="text-xs text-slate-400">Receive alerts via text message</p>
                  </div>
                </div>
                <Switch
                  checked={form.watch("smsEnabled")}
                  onCheckedChange={(v) => form.setValue("smsEnabled", v)}
                  data-testid="switch-sms"
                />
              </div>

              {form.watch("smsEnabled") && (
                <div className="pl-8" data-testid="phone-number-input">
                  <Label className="text-slate-300 text-sm mb-1 block">Phone Number</Label>
                  <Input
                    type="tel"
                    placeholder="+1 (555) 123-4567"
                    className="bg-slate-800 border-slate-600 text-white max-w-xs"
                    value={form.watch("phoneNumber") || ""}
                    onChange={(e) => form.setValue("phoneNumber", e.target.value)}
                    data-testid="input-phone"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                Alert Types
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between" data-testid="toggle-injury">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <div>
                    <Label className="text-white font-bold">Injury Alerts</Label>
                    <p className="text-xs text-slate-400">Get notified when rostered players have injury updates</p>
                  </div>
                </div>
                <Switch
                  checked={form.watch("injuryAlerts")}
                  onCheckedChange={(v) => form.setValue("injuryAlerts", v)}
                  data-testid="switch-injury"
                />
              </div>

              <div className="flex items-center justify-between" data-testid="toggle-scoring">
                <div className="flex items-center gap-3">
                  <Trophy className="w-5 h-5 text-emerald-400" />
                  <div>
                    <Label className="text-white font-bold">Scoring Milestones</Label>
                    <p className="text-xs text-slate-400">Alerts when players hit key scoring thresholds</p>
                  </div>
                </div>
                <Switch
                  checked={form.watch("scoringMilestones")}
                  onCheckedChange={(v) => form.setValue("scoringMilestones", v)}
                  data-testid="switch-scoring"
                />
              </div>

              <div className="flex items-center justify-between" data-testid="toggle-pregame">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-blue-400" />
                  <div>
                    <Label className="text-white font-bold">Pre-Game Reminders</Label>
                    <p className="text-xs text-slate-400">Reminder before your lineup locks</p>
                  </div>
                </div>
                <Switch
                  checked={form.watch("preGameReminders")}
                  onCheckedChange={(v) => form.setValue("preGameReminders", v)}
                  data-testid="switch-pregame"
                />
              </div>

              {form.watch("preGameReminders") && (
                <div className="pl-8" data-testid="pregame-minutes-select">
                  <Label className="text-slate-300 text-sm mb-1 block">Reminder Timing</Label>
                  <Select
                    value={String(form.watch("preGameMinutes"))}
                    onValueChange={(v) => form.setValue("preGameMinutes", Number(v))}
                  >
                    <SelectTrigger className="bg-slate-800 border-slate-600 text-white max-w-xs" data-testid="select-pregame-minutes">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes before</SelectItem>
                      <SelectItem value="30">30 minutes before</SelectItem>
                      <SelectItem value="60">1 hour before</SelectItem>
                      <SelectItem value="120">2 hours before</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 font-bold"
              disabled={mutation.isPending}
              data-testid="btn-save-notif-prefs"
            >
              {mutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Preferences
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
