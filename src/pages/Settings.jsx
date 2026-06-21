import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/services/supabase';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import TopBar from '@/components/layout/TopBar';

export default function Settings() {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const [profile, setProfile] = useState({
    phone: '',
    department: '',
  });
  const [preferences, setPreferences] = useState({
    theme: 'system',
    language: 'en',
    email_notifications: true,
  });
  const [saving, setSaving] = useState(false);

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
      const selectedLang = preferences.language;
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

  return (
    <div>
      <TopBar title="Settings" />
      <div className="p-6 max-w-3xl">
        <div className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <h3 className="font-heading font-semibold">Profile Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Full Name</Label>
                <Input value={user?.user_metadata?.full_name || ''} disabled className="bg-muted" />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={user?.email || ''} disabled className="bg-muted" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} />
              </div>
              <div>
                <Label>Department</Label>
                <Input value={profile.department} onChange={e => setProfile({...profile, department: e.target.value})} />
              </div>
              <div>
                <Label>Role</Label>
                <Input value={user?.user_metadata?.role?.replace(/_/g, ' ') || 'User'} disabled className="bg-muted capitalize" />
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <h3 className="font-heading font-semibold">Appearance</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Theme</Label>
                <Select value={preferences.theme} onValueChange={handleThemeChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Language</Label>
                <Select value={preferences.language} onValueChange={handleLanguageChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="it">Italiano</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <h3 className="font-heading font-semibold">Notification Preferences</h3>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-muted-foreground">Receive email notifications for important updates</p>
              </div>
              <Switch
                checked={preferences.email_notifications}
                onCheckedChange={v => setPreferences({...preferences, email_notifications: v})}
              />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}