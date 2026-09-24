import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { useAuth } from '@/lib/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/services/supabase';
import { subscribeUserToPush } from '@/hooks/usePushNotification';
import {
  Bell,
  Info,
  Languages,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Smartphone,
  Sun,
  User,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import TopBar from '@/components/layout/TopBar';
import Logo from '@/components/Logo';
import { APP_NAME, APP_VERSION_LABEL } from '@/lib/appInfo';
import { getUserFriendlyMessage, logAppError } from '@/lib/userErrors';

export default function Settings() {
  const { user } = useAuth();
  const { role } = useUserRole();
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState({
    phone: '',
    department: '',
  });
  const [preferences, setPreferences] = useState({
    theme: 'system',
    language: 'en',
    email_notifications: true,
  });
  const [retention, setRetention] = useState(7);
  const [saving, setSaving] = useState(false);
  const [pushState, setPushState] = useState({ loading: false, enabled: null, permission: null, supported: null });
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsLoaded, setSmsLoaded] = useState(false);
  const [smsSaving, setSmsSaving] = useState(false);
  const { setTheme } = useTheme();
  const [pushPrefEnabled, setPushPrefEnabled] = useState(true);
  const [pushPrefSaving, setPushPrefSaving] = useState(false);

  // Theme is owned by the root ThemeProvider (next-themes, class attribute,
  // system tracking, single 'app-theme' storage key). This screen only edits
  // the persisted selection; the provider applies it (no manual class writes).
  useEffect(() => {
    if (user) {
      setProfile({
        phone: user.user_metadata?.phone || '',
        department: user.user_metadata?.department || '',
      });
      const savedTheme = user.user_metadata?.preferences?.theme || localStorage.getItem('app-theme') || 'system';
      const savedLang = user.user_metadata?.preferences?.language || localStorage.getItem('app-language') || 'en';
      setPreferences((p) => ({
        ...p,
        theme: savedTheme,
        language: savedLang,
        email_notifications: user.user_metadata?.preferences?.email_notifications !== false,
      }));
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
        setTheme(savedTheme);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    supabase
      .from('profiles')
      .select('notification_retention_days, sms_notifications_enabled, push_notifications_enabled')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          logAppError('Settings', error, { operation: 'load-preferences' });
          return;
        }
        if (data?.notification_retention_days) {
          setRetention(data.notification_retention_days);
        }
        // Absent column (migration not applied) reads as undefined: keep the
        // safe default (false) and let the toggle save create it on write.
        if (typeof data?.sms_notifications_enabled === 'boolean') {
          setSmsEnabled(data.sms_notifications_enabled);
        }
        // Push preference defaults to true (preserves current delivery); an
        // absent column keeps the default until the toggle saves it.
        if (typeof data?.push_notifications_enabled === 'boolean') {
          setPushPrefEnabled(data.push_notifications_enabled);
        }
        setSmsLoaded(true);
      })
      .catch((err) => {
        if (active) logAppError('Settings', err, { operation: 'load-preferences' });
      });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    if (!supported) {
      setPushState((s) => ({ ...s, supported: false, enabled: false }));
      return;
    }
    setPushState((s) => ({
      ...s,
      supported: true,
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
    }));
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) =>
        setPushState((s) => ({
          ...s,
          enabled: !!sub,
          permission: typeof Notification !== 'undefined' ? Notification.permission : s.permission,
        }))
      )
    ).catch((err) => {
      logAppError('Settings', err, { operation: 'push-status' });
    });
  }, []);

  const handleThemeChange = (v) => {
    setPreferences(p => ({ ...p, theme: v }));
    // next-themes applies the class (incl. system tracking) and persists to
    // the shared 'app-theme' key; no manual DOM or storage writes here.
    setTheme(v);
  };

  const handleLanguageChange = (v) => {
    setPreferences(p => ({ ...p, language: v }));
    i18n.changeLanguage(v);
  };

  const handleSave = async () => {
    setSaving(true);

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      console.error('Auth guard failed — no authenticated user');
      toast.error('You must be logged in to save settings');
      setSaving(false);
      return;
    }

    try {
      const langCodeMap = { English: 'en', Français: 'fr', Italiano: 'it' };
      const selectedLang = langCodeMap[preferences.language] || preferences.language;
      const validLanguages = ['en', 'fr', 'it'];

      if (!validLanguages.includes(selectedLang)) {
        console.error('Invalid language code:', selectedLang);
        toast.error('Invalid language selected');
        setSaving(false);
        return;
      }

      await supabase.auth.updateUser({
        data: {
          phone: profile.phone,
          department: profile.department,
          preferences,
        }
      });

      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert({
          id: authUser.id,
          preferred_language: selectedLang,
          notification_retention_days: retention,
        });

      if (upsertError) throw upsertError;

      await i18n.changeLanguage(selectedLang);

      toast.success('Settings saved');
    } catch (error) {
      toast.error('Failed to save settings');
      console.error('Settings save error:', error);
    } finally {
      setSaving(false);
    }
  };

  // SMS opt-in saves instantly with its own loading guard: duplicate toggles
  // are ignored while a save is in flight, and the UI reverts on failure.
  // Enabling never sends an SMS; it only makes future reminders eligible.
  const handleSmsToggle = async (next) => {
    if (smsSaving || !user?.id) return;
    const previous = smsEnabled;
    setSmsEnabled(next);
    setSmsSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, sms_notifications_enabled: next }, { onConflict: 'id' });
      if (error) throw error;
      toast.success(t('smsSettingsUpdated', 'SMS notification settings updated.'));
    } catch (err) {
      setSmsEnabled(previous);
      logAppError('Settings', err, { operation: 'save-sms-preference', value: next });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveSmsSettings'));
    } finally {
      setSmsSaving(false);
    }
  };

  // Account-level push preference: instant save with its own loading guard.
  // OFF stops server-side push delivery; in-app notifications and SMS are
  // unaffected. Browser permission/subscription is tracked separately below.
  const handlePushPrefToggle = async (next) => {
    if (pushPrefSaving || !user?.id) return;
    const previous = pushPrefEnabled;
    setPushPrefEnabled(next);
    setPushPrefSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, push_notifications_enabled: next }, { onConflict: 'id' });
      if (error) throw error;
      toast.success(t('pushPrefUpdated', 'Push notification preference updated.'));
    } catch (err) {
      setPushPrefEnabled(previous);
      logAppError('Settings', err, { operation: 'save-push-preference', value: next });
      toast.error(getUserFriendlyMessage(err, t, 'errors.savePushPreference'));
    } finally {
      setPushPrefSaving(false);
    }
  };

  const handleEnablePush = async () => {
    if (pushState.enabled || pushState.loading) return;
    setPushState((s) => ({ ...s, loading: true }));
    try {
      const sub = await subscribeUserToPush(user?.id);
      if (sub) {
        setPushState((s) => ({
          ...s,
          loading: false,
          enabled: true,
          permission: typeof Notification !== 'undefined' ? Notification.permission : s.permission,
        }));
        toast.success(t('pushEnabled', 'Push notifications are enabled.'));
      } else {
        setPushState((s) => ({
          ...s,
          loading: false,
          permission: typeof Notification !== 'undefined' ? Notification.permission : s.permission,
        }));
        toast.error(t('pushEnableFailed', 'Unable to enable push notifications.'));
      }
    } catch (err) {
      logAppError('Settings', err, { operation: 'enable-push' });
      setPushState((s) => ({
        ...s,
        loading: false,
        permission: typeof Notification !== 'undefined' ? Notification.permission : s.permission,
      }));
      toast.error(getUserFriendlyMessage(err, t, 'errors.pushEnable'));
    }
  };

  // Application preference (subscribed) and browser permission (granted)
  // are separate: push counts as working only when both hold.
  const pushSupported = pushState.supported !== false;
  const pushBlocked = pushSupported && pushState.permission === 'denied';
  const pushWorking = pushSupported && !pushBlocked && !!pushState.enabled;
  const pushStatusKey = !pushSupported
    ? 'pushUnsupported'
    : pushBlocked
      ? 'pushBlocked'
      : pushState.enabled
        ? 'pushEnabledState'
        : 'pushDisabledState';

  return (
    <div>
      <TopBar title={t('settings')} />
      <div className="p-6 max-w-3xl">
        <div className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <h3 className="font-heading font-semibold flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" aria-hidden />
              {t('profileInformation')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>{t('fullName')}</Label>
                <Input value={user?.user_metadata?.full_name || ''} disabled className="bg-muted" />
              </div>
              <div>
                <Label>{t('email')}</Label>
                <Input value={user?.email || ''} disabled className="bg-muted" />
              </div>
              <div>
                <Label>{t('phone')}</Label>
                <Input value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} />
              </div>
              <div>
                <Label>{t('department')}</Label>
                <Input value={profile.department} onChange={e => setProfile({...profile, department: e.target.value})} />
              </div>
              <div>
                <Label>{t('role')}</Label>
                <Input value={role ? role.replace(/_/g, ' ') : 'User'} disabled className="bg-muted capitalize" />
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <h3 className="font-heading font-semibold flex items-center gap-2">
              <Palette className="w-4 h-4 text-muted-foreground" aria-hidden />
              {t('appearance')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>{t('theme')}</Label>
                <Select value={preferences.theme} onValueChange={handleThemeChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">
                      <span className="flex items-center gap-2">
                        <Sun className="w-4 h-4 text-muted-foreground" aria-hidden />{t('light')}
                      </span>
                    </SelectItem>
                    <SelectItem value="dark">
                      <span className="flex items-center gap-2">
                        <Moon className="w-4 h-4 text-muted-foreground" aria-hidden />{t('dark')}
                      </span>
                    </SelectItem>
                    <SelectItem value="system">
                      <span className="flex items-center gap-2">
                        <Monitor className="w-4 h-4 text-muted-foreground" aria-hidden />{t('system')}
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="flex items-center gap-2">
                  <Languages className="w-4 h-4 text-muted-foreground" aria-hidden />{t('language')}
                </Label>
                <Select value={preferences.language} onValueChange={handleLanguageChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">{t('english')}</SelectItem>
                    <SelectItem value="fr">{t('french')}</SelectItem>
                    <SelectItem value="it">{t('italian')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <h3 className="font-heading font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-muted-foreground" aria-hidden />
              {t('notificationPreferences')}
            </h3>
            <div className="flex items-center justify-between gap-4 py-2">
              <div className="flex items-start gap-3 min-w-0">
                <Bell className="w-4 h-4 mt-1 text-muted-foreground shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">{t('emailNotifications')}</p>
                  <p className="text-sm text-muted-foreground">{t('emailNotificationsDesc')}</p>
                </div>
              </div>
              <Switch
                checked={preferences.email_notifications}
                onCheckedChange={v => setPreferences({...preferences, email_notifications: v})}
                aria-label={t('emailNotifications')}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-2">
              <div className="flex items-start gap-3 min-w-0">
                <MessageSquare className="w-4 h-4 mt-1 text-muted-foreground shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium" id="sms-notifications-label">{t('smsNotifications', 'SMS Notifications')}</p>
                  <p className="text-sm text-muted-foreground" id="sms-notifications-desc">{t('smsNotificationsDesc', 'Receive supported notifications by SMS.')}</p>
                </div>
              </div>
              <Switch
                checked={smsEnabled}
                disabled={smsSaving || !smsLoaded}
                onCheckedChange={handleSmsToggle}
                aria-labelledby="sms-notifications-label"
                aria-describedby="sms-notifications-desc"
              />
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {smsSaving ? t('saving') : ''}
            </span>
            <div className="flex items-center justify-between gap-4 py-2">
              <div className="flex items-start gap-3 min-w-0">
                <Smartphone className="w-4 h-4 mt-1 text-muted-foreground shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium" id="push-pref-label">{t('pushPreference', 'Push delivery')}</p>
                  <p className="text-sm text-muted-foreground" id="push-pref-desc">{t('pushPreferenceDesc', 'Allow Geometra to send you browser push notifications.')}</p>
                </div>
              </div>
              <Switch
                checked={pushPrefEnabled}
                disabled={pushPrefSaving || !smsLoaded}
                onCheckedChange={handlePushPrefToggle}
                aria-labelledby="push-pref-label"
                aria-describedby="push-pref-desc"
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-2">
              <div className="min-w-0">
                <p className="font-medium">{t('pushNotifications', 'Push Notifications')}</p>
                <p className="text-sm text-muted-foreground">{t('pushNotificationsDesc', 'Receive alerts via browser push.')}</p>
                <p className="text-xs text-muted-foreground mt-1" role="status">
                  {t(pushStatusKey, pushStatusKey)}
                </p>
                {pushBlocked && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('pushBlockedHelp', 'Notifications are blocked by your browser. Allow them in your browser site settings, then try again.')}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant={pushWorking ? 'outline' : 'default'}
                onClick={handleEnablePush}
                disabled={pushState.loading || pushWorking || !pushSupported || pushBlocked}
                aria-live="polite"
              >
                {pushState.loading
                  ? t('pushEnabling', 'Enabling…')
                  : pushWorking
                    ? t('pushEnabledCta', 'Enabled')
                    : t('pushEnableCta', 'Enable')}
              </Button>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2">
              <div>
                <p className="font-medium">{t('notificationRetention')}</p>
                <p className="text-sm text-muted-foreground">{t('notificationRetentionDesc')}</p>
              </div>
              <Select value={String(retention)} onValueChange={(v) => setRetention(Number(v))}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t('retention24h')}</SelectItem>
                  <SelectItem value="7">{t('retention1week')}</SelectItem>
                  <SelectItem value="30">{t('retention1month')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-6 space-y-3">
            <h3 className="font-heading font-semibold flex items-center gap-2">
              <Info className="w-4 h-4 text-muted-foreground" aria-hidden />
              {t('aboutTitle', `About ${APP_NAME}`)}
            </h3>
            <div className="flex items-center gap-3">
              <Logo size={36} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">
                  {APP_NAME} {APP_VERSION_LABEL} — {t('aboutBetaBadge', 'Beta')}
                </p>
                <p>
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground uppercase tracking-wider">
                    {t('aboutBetaTag', 'Beta / Experimental')}
                  </span>
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{t('aboutP1')}</p>
            <p className="text-sm text-muted-foreground">{t('aboutP2')}</p>
          </div>
        </div>

        <div className="mt-6">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}