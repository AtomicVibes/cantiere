import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import TeamMemberCard from '@/components/teams/TeamMemberCard';
import EditMemberDialog from '@/components/teams/EditMemberDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Search, Users, LayoutGrid, List, Activity, Eye, EyeOff, Copy, Check, RefreshCw } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { useTeamFormFields } from '@/hooks/useFormSchema';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { PERMISSIONS } from '@/lib/permissions';
import { useDirection } from '@/i18n/LanguageProvider';
import { inviteUserByEmail, deleteUser } from '@/services/inviteService';
import { supabase } from '@/services/supabase';
import {
  checkAccountIdentity, isDuplicateError, duplicateErrorField,
  EMAIL_EXISTS_MESSAGE, USERNAME_TAKEN_MESSAGE,
} from '@/services/accountService';
import { isValidEmail, isValidUsername, isValidPassword, normalizeEmail, normalizeUsername } from '@/lib/validation';
import { generatePassword } from '@/lib/passwordGenerator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import AgentActivityDashboard from '@/components/teams/AgentActivityDashboard';

const emptyMember = { full_name: '', username: '', email: '', phone: '', job_title: '', department: '', status: 'active' };

export default function Teams() {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const { role } = useUserRole();
  const { isSuperAdmin } = useIsSuperAdmin();
  const canCreate = PERMISSIONS.canCreateTeamMember.includes(role);
  const canDelete = PERMISSIONS.canDeleteTeamMember.includes(role);
  const { fields, jobTitleOptions, statusOptions } = useTeamFormFields();
  const [showForm, setShowForm] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [form, setForm] = useState(emptyMember);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviteMode, setInviteMode] = useState('direct');
  const [friendlyError, setFriendlyError] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [activeTab, setActiveTab] = useState('members');
  const [password, setPassword] = useState('');
  const [passwordEdited, setPasswordEdited] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const openAddMember = () => {
    setForm(emptyMember);
    setFriendlyError('');
    // A fresh, visible, generated password every time the form opens.
    setPassword(generatePassword());
    setPasswordEdited(false);
    setShowPassword(true);
    setShowForm(true);
  };

  // Regenerate only rewrites the field: never submits, never touches the form.
  const handleRegeneratePassword = () => {
    setPassword(generatePassword());
    setPasswordEdited(false);
    setShowPassword(true);
  };

  const { members, isLoading } = useTeamMembers({ userRole: role, isSuperAdmin });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await deleteUser(id);
    },
    onSuccess: () => {
      toast.success('User deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['teamMemberCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['staffProfiles'] });
    },
    onError: (err) => {
      toast.error(err.message);
    },
    onSettled: () => {
      setDeleteTarget(null);
    },
  });

  const openEdit = (member) => {
    setEditingMember(member);
    setEditDialogOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canCreate) {
      toast.error(t('accessDenied'));
      return;
    }
    setFriendlyError('');

    const trimmedName = form.full_name.trim();
    const trimmedEmail = form.email.trim();
    const normalizedUsername = normalizeUsername(form.username);
    const isInviteMode = inviteMode === 'invite';

    if (!trimmedName) {
      setFriendlyError(`${t('fullName')} ${t('isRequired')}`);
      return;
    }
    if (!trimmedEmail) {
      setFriendlyError(`${t('email')} ${t('isRequired')}`);
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setFriendlyError(t('invalidEmail'));
      return;
    }
    if (!normalizedUsername) {
      setFriendlyError(`${t('username')} ${t('isRequired')}`);
      return;
    }
    if (!isValidUsername(normalizedUsername)) {
      setFriendlyError(t('invalidUsername'));
      return;
    }
    if (!isInviteMode && !isValidPassword(password)) {
      setFriendlyError(t('invalidPassword'));
      return;
    }

    setSaving(true);

    try {
      // Immediate feedback before any privileged call.
      const { emailAvailable, usernameAvailable } = await checkAccountIdentity({
        email: trimmedEmail,
        username: normalizedUsername,
      });
      if (!emailAvailable) {
        setFriendlyError(EMAIL_EXISTS_MESSAGE);
        setSaving(false);
        return;
      }
      if (!usernameAvailable) {
        setFriendlyError(USERNAME_TAKEN_MESSAGE);
        setSaving(false);
        return;
      }

      const res = await inviteUserByEmail({
        email: normalizeEmail(trimmedEmail),
        username: normalizedUsername,
        password: isInviteMode ? undefined : password,
        full_name: trimmedName,
        phone: form.phone,
        job_title: form.job_title,
        department: form.department,
        mode: inviteMode,
      });

      const newMember = {
        id: res.user.id,
        full_name: trimmedName,
        email: trimmedEmail,
        username: normalizedUsername,
        phone: form.phone || '',
        job_title: form.job_title || '',
        department: form.department || '',
        role_id: '',
        status: 'active',
      };
      queryClient.setQueryData(['teamMembers'], (prev = []) => [newMember, ...prev]);

      toast.success(isInviteMode ? 'Invite sent!' : t('accountCreatedShort', `Account created (${trimmedEmail})`));

      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['teamMemberCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['staffProfiles'] });

      // Organization/workspace context for the credential note (best-effort).
      let organization = '';
      try {
        const { data: orgRow } = await supabase
          .from('company_profiles')
          .select('display_name, legal_name')
          .limit(1)
          .maybeSingle();
        organization = orgRow?.display_name || orgRow?.legal_name || '';
      } catch {
        organization = '';
      }

      setCredentials({
        full_name: trimmedName,
        username: normalizedUsername,
        email: trimmedEmail,
        password: isInviteMode ? '' : password,
        role: 'User',
        organization,
        invite: isInviteMode,
      });

      // Drop the plaintext from the form state right away: the only remaining
      // copy lives in the credential note, cleared on Confirm.
      setPassword('');
      setPasswordEdited(false);
      setShowPassword(false);
      setForm(emptyMember);
      setShowForm(false);
    } catch (err) {
      if (isDuplicateError(err)) {
        setFriendlyError(duplicateErrorField(err) === 'username' ? USERNAME_TAKEN_MESSAGE : EMAIL_EXISTS_MESSAGE);
      } else {
        setFriendlyError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const credentialText = credentials
    ? [
        t('accountCreatedTitle'),
        '',
        `${t('fullName')}: ${credentials.full_name}`,
        `${t('username')}: ${credentials.username}`,
        `${t('email')}: ${credentials.email}`,
        ...(credentials.invite
          ? [`${t('password')}: ${t('invitationEmailNote', 'Sent by invitation email')}`]
          : [`${t('password')}: ${credentials.password}`]),
        `${t('role')}: ${credentials.role}`,
        ...(credentials.organization ? [`${t('organization')}: ${credentials.organization}`] : []),
      ].join('\n')
    : '';

  const handleCopyCredentials = async () => {
    try {
      await navigator.clipboard.writeText(credentialText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('copyFailed', 'Copy failed. Select the text and copy it manually.'));
    }
  };

  const handleConfirmCredentials = () => {
    setCredentials(null);
    setPassword('');
    setPasswordEdited(false);
    setShowPassword(false);
    setCopied(false);
    setForm(emptyMember);
    setFriendlyError('');
  };

  const filtered = members.filter(m =>
    !search || m.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <TopBar title={t('teams')} />
      <div className="p-6 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList aria-label={t('teams')}>
            <TabsTrigger value="members" className="gap-1.5">
              <Users className="w-4 h-4" aria-hidden />
              {t('teamMembers')}
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5">
              <Activity className="w-4 h-4" aria-hidden />
              {t('activityTracking', 'Activity Tracking')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="space-y-6 mt-4">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('searchMembers')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex items-center gap-3">
            <ToggleGroup type="single" value={viewMode} onValueChange={v => v && setViewMode(v)} className="border border-border rounded-lg p-0.5">
              <ToggleGroupItem value="grid" className="h-8 w-8 rounded-md data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <LayoutGrid className="w-4 h-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" className="h-8 w-8 rounded-md data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <List className="w-4 h-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            {canCreate && (
              <Button onClick={openAddMember} className="gap-2">
                <Plus className="w-4 h-4" /> {t('addMember')}
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title={t('noTeamMembers')} description={t('addFirstTeamMember')} actionLabel={canCreate ? t('addMember') : undefined} onAction={canCreate ? openAddMember : undefined} />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(member => (
              <TeamMemberCard key={member.id} member={member} layout="grid" onEdit={openEdit} onDelete={(id) => setDeleteTarget(id)} canDelete={canDelete} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(member => (
              <TeamMemberCard key={member.id} member={member} layout="list" onEdit={openEdit} onDelete={(id) => setDeleteTarget(id)} canDelete={canDelete} />
            ))}
          </div>
        )}
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <AgentActivityDashboard active={activeTab === 'activity'} />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); setFriendlyError(''); if (!v) setForm(emptyMember); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">{t('addMember')}</DialogTitle>
          </DialogHeader>
          {friendlyError && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3 border border-destructive/20" dir={dir}>
              {friendlyError}
            </div>
          )}
          <form onSubmit={handleSave} className="space-y-4" dir={dir}>
            {fields.filter(f => f.key !== 'role_id').map(field => {
              if (field.type === 'select') {
                let options = [];
                if (field.key === 'job_title') options = jobTitleOptions;
                else if (field.key === 'status') options = statusOptions;

                return (
                  <div key={field.key}>
                    <Label>{field.label}</Label>
                    <Select value={form[field.key]} onValueChange={v => setForm({...form, [field.key]: v})}>
                      <SelectTrigger><SelectValue placeholder={t('select')} /></SelectTrigger>
                      <SelectContent>
                        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              }
              return (
                <div key={field.key}>
                  <Label>{field.label}{field.required ? ' *' : ''}</Label>
                  <Input
                    type={field.type}
                    value={form[field.key] || ''}
                    onChange={e => setForm({...form, [field.key]: e.target.value})}
                    required={field.required}
                  />
                </div>
              );
            })}
            {inviteMode !== 'invite' && (
              <div>
                <Label htmlFor="member-password">{t('password')}</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="member-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => { setPassword(e.target.value); setPasswordEdited(true); }}
                      autoComplete="new-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 shrink-0 gap-1.5"
                    onClick={handleRegeneratePassword}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('regeneratePassword')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('generatedPasswordHint', 'A secure password was generated. Keep it or replace it with your own.')}
                </p>
              </div>
            )}
            <div>
              <Label>{t('provisioning')}</Label>
              <select
                value={inviteMode}
                onChange={e => setInviteMode(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="direct">{t('directCreation')}</option>
                <option value="invite">{t('sendInvitation')}</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || !form.full_name || !form.email || !form.username}>
                {saving ? t('creatingAccount') : t('createAccount')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Credential confirmation — only dismissed via Confirm (spec §14-15) */}
      <AlertDialog open={!!credentials} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">{t('accountCreatedTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <pre className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm font-mono text-foreground text-left" dir="ltr">
                {credentialText}
              </pre>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogAction asChild>
              <Button type="button" variant="outline" className="gap-2" onClick={handleCopyCredentials}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? t('copied', 'Copied') : t('copyAccountInformation')}
              </Button>
            </AlertDialogAction>
            <AlertDialogAction asChild>
              <Button type="button" onClick={handleConfirmCredentials}>{t('confirmAction')}</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditMemberDialog
        member={editingMember}
        open={editDialogOpen}
        onOpenChange={(v) => { setEditDialogOpen(v); if (!v) setEditingMember(null); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team member</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this user and all of their associated data
              (messages, notifications, and assignments). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget);
              }}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Yes, delete it'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
