import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  Settings as SettingsIcon,
  Shield,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { logAppError } from '@/lib/userErrors';

const EMPTY_CONFIG = {
  api_url: '',
  client_id: '',
  tenant_id: '',
  company_id: '',
  enabled: false,
  sync_invoices: false,
  sync_clients: false,
  sync_products: false,
  sync_direction: 'export',
  sync_interval_minutes: 60,
};

const STATUS_KEY = {
  not_connected: 'sageStatusNotConnected',
  not_configured: 'sageStatusNotConfigured',
  configured: 'sageStatusConfigured',
  connected: 'sageStatusConnected',
  error: 'sageStatusError',
};

function applyStatus(payload, setState) {
  if (!payload?.config) return;
  setState({
    api_url: payload.config.apiUrl || '',
    client_id: payload.config.clientId || '',
    tenant_id: payload.config.tenantId || '',
    company_id: payload.config.companyId || '',
    enabled: Boolean(payload.config.enabled),
    sync_invoices: Boolean(payload.config.syncInvoices),
    sync_clients: Boolean(payload.config.syncClients),
    sync_products: Boolean(payload.config.syncProducts),
    sync_direction: payload.config.syncDirection || 'export',
    sync_interval_minutes: payload.config.syncIntervalMinutes || 60,
  });
}

export default function IntegrationsPanel() {
  const { t } = useTranslation();
  const [config, setConfig] = useState(EMPTY_CONFIG);
  // Write-only: cleared after every save and never read back from the server.
  const [clientSecret, setClientSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [serverStatus, setServerStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const setField = (key, value) => setConfig((prev) => ({ ...prev, [key]: value }));

  const loadStatus = useCallback(async () => {
    const result = await invokeEdgeFunction('sage-connection', { action: 'status' }, t('errors.sageLoad'), t);
    if (!result.ok) {
      logAppError('Settings', new Error(result.message), { operation: 'sage-status' });
      setLoadError(result.message);
      setLoading(false);
      return false;
    }
    setLoadError(null);
    setServerStatus(result.data);
    setHasSecret(Boolean(result.data?.hasSecret));
    applyStatus(result.data, setConfig);
    setLoading(false);
    return true;
  }, [t]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setTestResult(null);
    try {
      const result = await invokeEdgeFunction(
        'sage-connection',
        {
          action: 'save',
          apiUrl: config.api_url,
          clientId: config.client_id,
          tenantId: config.tenant_id,
          companyId: config.company_id,
          enabled: config.enabled,
          syncInvoices: config.sync_invoices,
          syncClients: config.sync_clients,
          syncProducts: config.sync_products,
          syncDirection: config.sync_direction,
          syncIntervalMinutes: config.sync_interval_minutes,
          ...(clientSecret ? { clientSecret } : {}),
        },
        t('errors.sageSave'),
        t,
      );
      if (!result.ok) {
        setLoadError(result.message);
        toast.error(result.message);
        return;
      }
      setLoadError(null);
      setClientSecret('');
      setServerStatus(result.data);
      setHasSecret(Boolean(result.data?.hasSecret));
      applyStatus(result.data, setConfig);
      toast.success(t('sageConfigSaved'));
    } catch (err) {
      logAppError('Settings', err, { operation: 'save-sage-config' });
      toast.error(t('errors.sageSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invokeEdgeFunction('sage-connection', { action: 'test' }, t('errors.sageTest'), t);
      if (!result.ok) {
        setTestResult({ ok: false, message: result.message });
        toast.error(result.message);
        await loadStatus();
        return;
      }
      setTestResult(result.data);
      if (result.data?.ok) toast.success(t('sageConnectionTestOk'));
      else toast.error(result.data?.message || t('sageConnectionTestFailed'));
      await loadStatus();
    } catch (err) {
      logAppError('Settings', err, { operation: 'sage-test' });
      setTestResult({ ok: false, message: t('errors.sageTest') });
      toast.error(t('errors.sageTest'));
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await invokeEdgeFunction(
        'sage-sync',
        {
          sync_invoices: config.sync_invoices,
          sync_clients: config.sync_clients,
          sync_products: config.sync_products,
        },
        t('errors.sageSyncFailed'),
        t,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const warnings = result.data?.results
        ? result.data.results.invoices.errors.length +
          result.data.results.clients.errors.length +
          result.data.results.products.errors.length
        : 0;
      if (warnings > 0) toast.warning(result.data?.message || t('sageSyncPartial'));
      else toast.success(t('sageSyncSuccess'));
      await loadStatus();
    } catch (err) {
      logAppError('Settings', err, { operation: 'sage-sync' });
      toast.error(t('errors.sageSyncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (disconnecting) return;
    if (!window.confirm(t('sageDisconnectConfirm'))) return;
    setDisconnecting(true);
    try {
      const result = await invokeEdgeFunction('sage-connection', { action: 'disconnect' }, t('errors.sageDisconnect'), t);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setClientSecret('');
      setHasSecret(false);
      setServerStatus(result.data);
      setTestResult(null);
      applyStatus(result.data, setConfig);
      toast.success(t('sageDisconnected'));
    } catch (err) {
      logAppError('Settings', err, { operation: 'sage-disconnect' });
      toast.error(t('errors.sageDisconnect'));
    } finally {
      setDisconnecting(false);
    }
  };

  const connectionStatus = serverStatus?.config?.connectionStatus || 'not_connected';
  const statusLabel = t(STATUS_KEY[connectionStatus] || 'sageStatusNotConnected');
  const isConnected = connectionStatus === 'connected';
  const canSync = Boolean(serverStatus?.config?.enabled) && Boolean(serverStatus?.complete);
  const lastError = serverStatus?.config?.lastSyncError || null;
  const secretLabel = hasSecret
    ? clientSecret
      ? t('sageSecretUpdated')
      : t('sageSecretStored')
    : t('sageSecretNotStored');

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <h3 className="font-heading font-semibold flex items-center gap-2">
          <SettingsIcon className="w-4 h-4 text-muted-foreground" aria-hidden />
          {t('sageIntegration')}
        </h3>
        <div className="text-center py-8 text-muted-foreground">{t('loading')}</div>
      </div>
    );
  }

  if (loadError && !serverStatus) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <h3 className="font-heading font-semibold flex items-center gap-2">
          <SettingsIcon className="w-4 h-4 text-muted-foreground" aria-hidden />
          {t('sageIntegration')}
        </h3>
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 space-y-3">
          <p className="text-sm text-destructive">{t('integrationsUnavailable')}</p>
          <p className="text-sm text-muted-foreground break-words">{loadError}</p>
          <Button variant="outline" size="sm" onClick={loadStatus}>
            <RefreshCw className="w-4 h-4 mr-2" aria-hidden />
            {t('retry', 'Retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-4">
      <h3 className="font-heading font-semibold flex items-center gap-2">
        <SettingsIcon className="w-4 h-4 text-muted-foreground" aria-hidden />
        {t('sageIntegration')}
      </h3>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isConnected ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" aria-hidden />
                {t('sageConnected')}
              </>
            ) : (
              <>
                <Shield className="w-4 h-4 text-muted-foreground" aria-hidden />
                {statusLabel}
              </>
            )}
          </CardTitle>
          <CardDescription>{t('sageIntegrationDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span>
              {t('sageConnectionStatus')}: <span className="font-medium text-foreground">{statusLabel}</span>
            </span>
            <span>
              {t('sageLastTest')}:{' '}
              {serverStatus?.config?.lastConnectionTestAt
                ? new Date(serverStatus.config.lastConnectionTestAt).toLocaleString()
                : t('sageNeverTested')}
            </span>
            <span>
              {t('sageLastSync')}:{' '}
              {serverStatus?.config?.lastSync
                ? new Date(serverStatus.config.lastSync).toLocaleString()
                : '—'}
            </span>
            <span>{secretLabel}</span>
          </div>

          {serverStatus?.config?.lastConnectionTestStatus && (
            <p className="text-sm text-muted-foreground">
              {t('sageLastTest')}: {serverStatus.config.lastConnectionTestStatus}
            </p>
          )}

          {lastError && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <p className="text-xs font-medium text-destructive mb-1">{t('sageLastSyncError')}</p>
              <p className="text-sm text-muted-foreground break-words">{lastError}</p>
              {serverStatus?.config?.lastSyncErrorAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(serverStatus.config.lastSyncErrorAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sage-api-url">{t('sageApiUrl')}</Label>
              <Input
                id="sage-api-url"
                value={config.api_url}
                onChange={(e) => setField('api_url', e.target.value)}
                placeholder={t('sageApiUrlPlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="sage-client-id">{t('sageClientId')}</Label>
              <Input
                id="sage-client-id"
                value={config.client_id}
                onChange={(e) => setField('client_id', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sage-client-secret">{t('sageClientSecret')}</Label>
              <Input
                id="sage-client-secret"
                type="password"
                autoComplete="new-password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={t('sageClientSecretPlaceholder')}
              />
              <p className="text-xs text-muted-foreground mt-1">{t('sageSecretWriteOnly')}</p>
            </div>
            <div>
              <Label htmlFor="sage-tenant-id">{t('sageTenantId')}</Label>
              <Input
                id="sage-tenant-id"
                value={config.tenant_id}
                onChange={(e) => setField('tenant_id', e.target.value)}
                placeholder={t('sageTenantIdPlaceholder')}
              />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="font-medium">{t('sageEnableIntegration')}</p>
              <p className="text-xs text-muted-foreground">{t('sageEnableHint')}</p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => setField('enabled', checked)}
              aria-label={t('sageEnableIntegration')}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="font-medium flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-muted-foreground" aria-hidden />
              {t('syncOptions')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.sync_invoices}
                  onChange={(e) => setField('sync_invoices', e.target.checked)}
                />
                <span>{t('sageSyncInvoices')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.sync_clients}
                  onChange={(e) => setField('sync_clients', e.target.checked)}
                />
                <span>{t('sageSyncClients')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.sync_products}
                  onChange={(e) => setField('sync_products', e.target.checked)}
                />
                <span>{t('sageSyncProducts')}</span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <Label>{t('sageSyncDirection')}</Label>
                <Select
                  value={config.sync_direction}
                  onValueChange={(value) => setField('sync_direction', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="export">{t('sageSyncDirectionExport')}</SelectItem>
                    <SelectItem value="import">{t('sageSyncDirectionImport')}</SelectItem>
                    <SelectItem value="both">{t('sageSyncDirectionBoth')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="sage-sync-interval">{t('sageSyncInterval')}</Label>
                <Input
                  id="sage-sync-interval"
                  type="number"
                  min="5"
                  max="1440"
                  value={config.sync_interval_minutes}
                  onChange={(e) => setField('sync_interval_minutes', Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {testResult && (
            <div
              className={`rounded-lg border p-3 ${testResult.ok ? 'border-green-500/30 bg-green-500/10' : 'border-destructive/30 bg-destructive/10'}`}
            >
              <p className="text-sm font-medium flex items-center gap-2">
                {testResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" aria-hidden />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-destructive" aria-hidden />
                )}
                {testResult.ok ? t('sageConnectionTestOk') : t('sageConnectionTestFailed')}
              </p>
              {testResult.message && (
                <p className="text-sm text-muted-foreground break-words mt-1">{testResult.message}</p>
              )}
              {typeof testResult.httpStatus === 'number' && (
                <p className="text-xs text-muted-foreground mt-1">HTTP {testResult.httpStatus}</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={testing || !config.api_url}>
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : <Plug className="w-4 h-4 mr-2" aria-hidden />}
              {testing ? t('sageTesting') : t('sageTestConnection')}
            </Button>
            <Button variant="outline" onClick={handleSync} disabled={syncing || !canSync}>
              {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : <Zap className="w-4 h-4 mr-2" aria-hidden />}
              {syncing ? t('sageSyncing') : t('sageSyncNow')}
            </Button>
            <Button
              variant="ghost"
              onClick={handleDisconnect}
              disabled={disconnecting || (!serverStatus?.configured && !hasSecret)}
            >
              {disconnecting ? t('saving') : t('disconnectSage')}
            </Button>
          </div>

          {!canSync && config.enabled && (
            <p className="text-xs text-muted-foreground">{t('sageEnableHint')}</p>
          )}
          {!config.enabled && (
            <p className="text-xs text-muted-foreground">{t('sageSyncRequiresEnabled')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
