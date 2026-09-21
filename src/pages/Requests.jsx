import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ClipboardList, ShieldCheck } from 'lucide-react';
import TopBar from '@/components/layout/TopBar';
import ProjectRequests from '@/pages/ProjectRequests';
import AdminInbox from '@/pages/AdminInbox';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';

export default function Requests() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isSuperAdmin, loading } = useIsSuperAdmin();

  const activeView = searchParams.get('view') === 'management' ? 'management' : 'my';

  const selectView = (view) => {
    const next = new URLSearchParams(searchParams);
    if (view === 'management') next.set('view', 'management');
    else next.delete('view');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (loading) return;
    if (activeView === 'management' && !isSuperAdmin) {
      navigate('/requests', { replace: true });
    }
  }, [activeView, isSuperAdmin, loading, navigate]);

  const canManage = isSuperAdmin;
  const showManagement = canManage && activeView === 'management';

  return (
    <div>
      <TopBar title={t('requests')} />
      <div className="p-4 md:p-6 space-y-6" style={{ padding: 'clamp(1rem, 2.5vw, 1.5rem)' }}>
        <div className="flex gap-1 bg-muted p-1 rounded-lg overflow-x-auto">
          <button
            onClick={() => selectView('my')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] ${
              activeView === 'my' || !canManage
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            style={{ fontSize: 'clamp(0.75rem, 1.2vw, 0.875rem)' }}
          >
            <ClipboardList className="w-4 h-4" />
            {t('myRequests')}
          </button>
          {canManage && (
            <button
              onClick={() => selectView('management')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] ${
                showManagement
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={{ fontSize: 'clamp(0.75rem, 1.2vw, 0.875rem)' }}
            >
              <ShieldCheck className="w-4 h-4" />
              {t('requestManagement')}
            </button>
          )}
        </div>

        {showManagement ? <AdminInbox embedded /> : <ProjectRequests embedded />}
      </div>
    </div>
  );
}