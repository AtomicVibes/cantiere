import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/services/supabase';
import { subscribeUserToPush } from '@/hooks/usePushNotification';

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
  const [pushState, setPushState] = useState({ loading: false, enabled: null });
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsLoaded, setSmsLoaded] = useState(false);
  const [smsSaving, setSmsSaving] = useState(false);

  const applyTheme = (theme) => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      prefersDark ? root.classList.add('dark') : root.classList.remove('dark');
    }
  };

  useEffect(() => {
    if (user) {
      setProfile({
        phone: user.user_metadata?.phone || '',
        department: user.user_metadata?.department || '',
      });
      const savedTheme = user.user_metadata?.preferences?.theme || localStorage.getItem('app-theme') || 'system';
      const savedLang = user.user_metadata?.preferences?.language || localStorage.getItem('app-language') || 'en';
      setPreferences({
        theme: savedTheme,
        language: savedLang,
        email_notifications: user.user_metadata?.preferences?.email_notifications !== false,
      });
      applyTheme(savedTheme);
    }
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    supabase
      .from('profiles')
      .select('notification_retention_days, sms_notifications_enabled')
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
        setSmsLoaded(true);
      })
      .catch((err) => {
        if (active) logAppError('Settings', err, { operation: 'load-preferences' });
      });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) =>
          setPushState((s) => ({ ...s, enabled: !!sub }))
        )
      ).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (preferences.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preferences.theme]);

  const handleThemeChange = (v) => {
    setPreferences(p => ({ ...p, theme: v }));
    applyTheme(v);
    localStorage.setItem('app-theme', v);
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

  const handleEnablePush = async () => {
    if (pushState.enabled) return;
    setPushState((s) => ({ ...s, loading: true }));
    const sub = await subscribeUserToPush(user?.id);
    if (sub) {
      setPushState({ loading: false, enabled: true });
      toast.success('Push notifications enabled');
    } else {
      setPushState((s) => ({ ...s, loading: false }));
      toast.error('Could not enable push notifications. Check browser permissions.');
    }
  };

  return (
    <div>
      <TopBar title={t('settings')} />
      <div className="p-6 max-w-3xl">
        <div className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <h3 className="font-heading font-semibold">{t('profileInformation')}</h3>
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
            <h3 className="font-heading font-semibold">{t('appearance')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>{t('theme')}</Label>
                <Select value={preferences.theme} onValueChange={handleThemeChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">{t('light')}</SelectItem>
                    <SelectItem value="dark">{t('dark')}</SelectItem>
                    <SelectItem value="system">{t('system')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('language')}</Label>
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
            <h3 className="font-heading font-semibold">{t('notificationPreferences')}</h3>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">{t('emailNotifications')}</p>
                <p className="text-sm text-muted-foreground">{t('emailNotificationsDesc')}</p>
              </div>
              <Switch
                checked={preferences.email_notifications}
                onCheckedChange={v => setPreferences({...preferences, email_notifications: v})}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <p className="font-medium" id="sms-notifications-label">{t('smsNotifications', 'SMS Notifications')}</p>
                <p className="text-sm text-muted-foreground" id="sms-notifications-desc">{t('smsNotificationsDesc', 'Receive supported notifications by SMS.')}</p>
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
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">Push Notifications</p>
                <p className="text-sm text-muted-foreground">Receive alerts via browser push</p>
              </div>
              <Button
                size="sm"
                variant={pushState.enabled ? 'outline' : 'default'}
                onClick={handleEnablePush}
                disabled={pushState.loading || pushState.enabled}
              >
                {pushState.loading ? 'Enabling...' : pushState.enabled ? 'Enabled' : 'Enable'}
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
            <h3 className="font-heading font-semibold">{t('aboutTitle', `About ${APP_NAME}`)}</h3>
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