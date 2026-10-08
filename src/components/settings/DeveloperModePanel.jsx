import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Activity,
  Bug,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  FileSpreadsheet,
  Flag,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDeveloperMode } from '@/hooks/useDeveloperMode';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { logAppError } from '@/lib/userErrors';
import { supabase } from '@/services/supabase';
import { APP_NAME, APP_VERSION_LABEL } from '@/lib/appInfo';

const MAX_RESULT_CHARS = 4000;

// Curated read-only requests: no arbitrary URL can be typed in, so the
// tester cannot be used to reach anything outside this project.
const API_ENDPOINTS = [
  {
    id: 'super-admin',
    label: 'RPC auth_user_is_super_admin',
    run: () => supabase.rpc('auth_user_is_super_admin'),
  },
  {
    id: 'profile',
    label: 'GET /profiles?select=id,full_name&limit=3',
    run: () => supabase.from('profiles').select('id, full_name').limit(3),
  },
  {
    id: 'audit',
    label: 'GET /audit_logs?select=action_type,message,created_at&limit=5',
    run: () =>
      supabase
        .from('audit_logs')
        .select('action_type, message, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
  },
  {
    id: 'invoices',
    label: 'GET /invoices?select=invoice_number,total,sage_sync_status&limit=5',
    run: () =>
      supabase
        .from('invoices')
        .select('invoice_number, total, sage_sync_status')
        .order('created_at', { ascending: false })
        .limit(5),
  },
  {
    id: 'developer-mode',
    label: 'GET /developer_mode?select=enabled,expires_at&limit=1',
    run: () => supabase.from('developer_mode').select('enabled, expires_at').limit(1),
  },
];

function truncate(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return '';
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n…` : text;
}

async function runDiagnostics() {
  const checks = [];

  const session = await supabase.auth.getSession();
  checks.push({
    key: 'session',
    ok: Boolean(session?.data?.session),
    detail: session?.data?.session ? 'Session active' : 'No active session',
  });

  const profile = await supabase.from('profiles').select('id, full_name').limit(1);
  checks.push({
    key: 'profile',
    ok: !profile.error,
    detail: profile.error ? profile.error.message : 'Profile readable under RLS',
  });

  const role = await supabase.rpc('auth_user_is_super_admin');
  checks.push({
    key: 'role',
    ok: !role.error,
    detail: role.error ? role.error.message : `super_admin=${String(role.data)}`,
  });

  const audit = await supabase
    .from('audit_logs')
    .select('action_type, created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  checks.push({
    key: 'audit',
    ok: !audit.error,
    detail: audit.error ? audit.error.message : 'Audit log readable',
  });

  const devMode = await invokeEdgeFunction('developer-mode-toggle', { action: 'status' });
  checks.push({
    key: 'devMode',
    ok: devMode.ok,
    detail: devMode.ok ? 'Edge function reachable' : devMode.message,
  });

  const sage = await invokeEdgeFunction('sage-connection', { action: 'status' });
  checks.push({
    key: 'sage',
    ok: sage.ok,
    detail: sage.ok ? 'Edge function reachable' : sage.message,
  });

  return checks;
}

const CHECK_LABELS = {
  session: 'Session',
  profile: 'Profile (RLS)',
  role: 'Role check',
  audit: 'Audit log',
  devMode: 'developer-mode-toggle',
  sage: 'sage-connection',
};

export default function DeveloperModePanel() {
  const { t, i18n } = useTranslation();
  const { status, active, loading, refresh } = useDeveloperMode();
  const [secret, setSecret] = useState('');
  const [secretError, setSecretError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState(null);
  const [checksBusy, setChecksBusy] = useState(false);
  const [endpointId, setEndpointId] = useState(API_ENDPOINTS[0].id);
  const [apiResult, setApiResult] = useState(null);
  const [apiBusy, setApiBusy] = useState(false);

  const handleActivate = async () => {
    if (busy || !secret) return;
    setBusy(true);
    setSecretError('');
    try {
      const result = await invokeEdgeFunction(
        'developer-mode-toggle',
        { action: 'activate', secret },
        t('errors.devModeActivateFailed'),
        t,
      );
      if (!result.ok) {
        setSecretError(result.message);
        toast.error(result.message);
        logAppError('Settings', new Error(result.message), { operation: 'dev-mode-activate' });
        await refresh();
        return;
      }
      setSecret('');
      await refresh();
      toast.success(t('devModeActivated'));
    } catch (err) {
      logAppError('Settings', err, { operation: 'dev-mode-activate' });
      toast.error(t('errors.devModeActivateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await invokeEdgeFunction(
        'developer-mode-toggle',
        { action: 'deactivate' },
        t('errors.devModeDeactivateFailed'),
        t,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      await refresh();
      toast.success(t('devModeDeactivated'));
    } catch (err) {
      logAppError('Settings', err, { operation: 'dev-mode-deactivate' });
      toast.error(t('errors.devModeDeactivateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleDiagnostics = async () => {
    if (checksBusy) return;
    setChecksBusy(true);
    try {
      const result = await runDiagnostics();
      setChecks(result);
      if (result.every((check) => check.ok)) toast.success(t('devDiagnosticsPassed'));
      else toast.error(t('devDiagnosticsFailed'));
    } catch (err) {
      logAppError('Settings', err, { operation: 'dev-diagnostics' });
      toast.error(t('errors.devModeDiagnostics'));
    } finally {
      setChecksBusy(false);
    }
  };

  const handleApiTest = async () => {
    if (apiBusy) return;
    const endpoint = API_ENDPOINTS.find((item) => item.id === endpointId) || API_ENDPOINTS[0];
    setApiBusy(true);
    setApiResult(null);
    try {
      const { data, error } = await endpoint.run();
      setApiResult({
        ok: !error,
        label: endpoint.label,
        body: error ? { error: error.message, code: error.code ?? null } : data,
      });
    } catch (err) {
      setApiResult({ ok: false, label: endpoint.label, body: { error: err?.message || 'Request failed.' } });
    } finally {
      setApiBusy(false);
    }
  };

  const capabilities = [
    { icon: Activity, title: t('devCapabilityDiagnostics'), desc: t('devCapabilityDiagnosticsDesc') },
    { icon: Terminal, title: t('devCapabilityApiTester'), desc: t('devCapabilityApiTesterDesc') },
    { icon: Flag, title: t('devCapabilityFeatureFlags'), desc: t('devCapabilityFeatureFlagsDesc') },
    { icon: FileSpreadsheet, title: t('devCapabilityAudit'), desc: t('devCapabilityAuditDesc') },
  ];

  const featureFlags = [
    { label: 'App', value: `${APP_NAME} ${APP_VERSION_LABEL}` },
    { label: 'Build mode', value: import.meta.env.MODE },
    { label: 'Language', value: i18n?.language || 'en' },
    { label: 'Timezone', value: Intl.DateTimeFormat().resolvedOptions().timeZone || '—' },
    { label: 'Developer Mode', value: active ? 'on' : 'off' },
  ];

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-4">
      <h3 className="font-heading font-semibold flex items-center gap-2">
        <Terminal className="w-4 h-4 text-muted-foreground" aria-hidden />
        {t('developerMode')}
      </h3>

      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
        <p className="text-sm text-destructive">{t('developerModeWarning')}</p>
      </div>

      {loading && <div className="text-center py-8 text-muted-foreground">{t('loading')}</div>}

      {!loading && (
        <>
          {!active ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Circle className="w-4 h-4 text-muted-foreground" aria-hidden />
                  {status?.expired ? t('devExpired') : t('developerModeInactive')}
                </CardTitle>
                <CardDescription>{t('devModeDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="dev-mode-secret">{t('developerModeSecret')}</Label>
                  <Input
                    id="dev-mode-secret"
                    type="password"
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => {
                      setSecret(e.target.value);
                      setSecretError('');
                    }}
                    placeholder={t('developerModeSecretPlaceholder')}
                    className={secretError ? 'border-destructive' : ''}
                  />
                  {secretError && (
                    <p className="text-sm text-destructive mt-1">{secretError}</p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <Button onClick={handleActivate} disabled={busy || !secret}>
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : <Zap className="w-4 h-4 mr-2" aria-hidden />}
                    {busy ? t('saving') : t('developerModeActivate')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={refresh} disabled={busy}>
                    <RefreshCw className="w-4 h-4 mr-2" aria-hidden />
                    {t('devRefreshStatus')}
                  </Button>
                </div>
                {status?.locked && status.lockedUntil && (
                  <p className="text-xs text-muted-foreground">
                    {t('devLocked')} {new Date(status.lockedUntil).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-green-500" aria-hidden />
                  {t('developerModeActive')}
                  <Badge variant="secondary">{t('devModeIndicator')}</Badge>
                </CardTitle>
                <CardDescription>{t('developerModeActiveDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  {status?.activatedAt && (
                    <span>{t('activatedAt', 'Activated')}: {new Date(status.activatedAt).toLocaleString()}</span>
                  )}
                  {status?.expiresAt && (
                    <span>{t('devExpiresAt')}: {new Date(status.expiresAt).toLocaleString()}</span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <Button variant="destructive" onClick={handleDeactivate} disabled={busy}>
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : null}
                    {busy ? t('saving') : t('developerModeDeactivate')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={refresh} disabled={busy}>
                    <RefreshCw className="w-4 h-4 mr-2" aria-hidden />
                    {t('devRefreshStatus')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('devCapabilities')}</CardTitle>
              <CardDescription>{t('devCapabilitiesDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {capabilities.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="rounded-lg border border-border p-4 space-y-1"
                  aria-disabled={!active}
                >
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Icon className="w-4 h-4 text-muted-foreground" aria-hidden />
                    {title}
                    {!active && <Badge variant="outline">{t('developerModeInactive')}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" aria-hidden />
                {t('devDiagnostics')}
              </CardTitle>
              <CardDescription>{t('devCapabilityDiagnosticsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button variant="outline" onClick={handleDiagnostics} disabled={checksBusy || !active}>
                {checksBusy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />
                ) : (
                  <Play className="w-4 h-4 mr-2" aria-hidden />
                )}
                {checksBusy ? t('devDiagnosticsRunning') : t('devDiagnosticsRun')}
              </Button>
              {!active && <p className="text-sm text-muted-foreground">{t('devApiTesterLocked')}</p>}
              {checks && (
                <ul className="space-y-2">
                  {checks.map((check) => (
                    <li key={check.key} className="flex items-start gap-2 text-sm">
                      {check.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5" aria-hidden />
                      ) : (
                        <Circle className="w-4 h-4 text-destructive mt-0.5" aria-hidden />
                      )}
                      <span className="font-medium">{CHECK_LABELS[check.key] || check.key}</span>
                      <span className="text-muted-foreground break-words">{check.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bug className="w-4 h-4 text-muted-foreground" aria-hidden />
                {t('devApiTester')}
              </CardTitle>
              <CardDescription>{t('devCapabilityApiTesterDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={endpointId} onValueChange={setEndpointId} disabled={!active}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {API_ENDPOINTS.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleApiTest} disabled={apiBusy || !active}>
                  {apiBusy ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />
                  ) : (
                    <Play className="w-4 h-4 mr-2" aria-hidden />
                  )}
                  {apiBusy ? t('devApiTesterRunning') : t('devApiTesterRun')}
                </Button>
              </div>
              {!active && <p className="text-sm text-muted-foreground">{t('devApiTesterLocked')}</p>}
              {apiResult && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{apiResult.label}</p>
                  <pre
                    className={`rounded-lg border p-3 text-xs overflow-auto max-h-64 whitespace-pre-wrap break-words ${
                      apiResult.ok ? 'border-border bg-secondary' : 'border-destructive/30 bg-destructive/10'
                    }`}
                  >
                    {truncate(apiResult.body)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-muted-foreground" aria-hidden />
                {t('devFeatureFlags')}
              </CardTitle>
              <CardDescription>{t('devCapabilityFeatureFlagsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {featureFlags.map((flag) => (
                <div key={flag.label} className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
                  <span className="text-muted-foreground">{flag.label}</span>
                  <span className="font-medium">{flag.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-muted-foreground" aria-hidden />
                {t('devTroubleshooting')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert>
                <ClipboardList className="h-4 w-4" aria-hidden />
                <AlertTitle>{t('devTroubleshootingSecret')}</AlertTitle>
                <AlertDescription>{t('devTroubleshootingExpiry')}</AlertDescription>
              </Alert>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Circle className="w-3 h-3 mt-1.5 shrink-0" aria-hidden />
                  {t('devTroubleshootingLocked')}
                </li>
                <li className="flex items-start gap-2">
                  <Circle className="w-3 h-3 mt-1.5 shrink-0" aria-hidden />
                  {t('devTroubleshootingFunction')}
                </li>
                <li className="flex items-start gap-2">
                  <Circle className="w-3 h-3 mt-1.5 shrink-0" aria-hidden />
                  {t('devTroubleshootingRole')}
                </li>
              </ul>
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
                  <ChevronDown className="w-4 h-4" aria-hidden />
                  {t('logs.auditLogs')}
                </CollapsibleTrigger>
                <CollapsibleContent className="text-sm text-muted-foreground pt-2">
                  {t('developerModeWarning')}
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
