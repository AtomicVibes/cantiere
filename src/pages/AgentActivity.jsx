import React from 'react';
import { useTranslation } from 'react-i18next';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import AgentActivityDashboard from '@/components/teams/AgentActivityDashboard';
import { useUserRole } from '@/hooks/useUserRole';
import { ShieldAlert } from 'lucide-react';

// Standalone Agent Activity screen (admin/manager roles). Reuses the same
// dashboard component as the Teams sub-tab; data stays RLS-enforced and
// the component fetches only when mounted.
export default function AgentActivity() {
  const { t } = useTranslation();
  const { isManager, isLoading } = useUserRole();

  if (isLoading) {
    return (
      <div>
        <TopBar title={t('activityDashboard', 'Agent Activity')} />
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!isManager) {
    return (
      <div>
        <TopBar title={t('activityDashboard', 'Agent Activity')} />
        <div className="p-6">
          <EmptyState
            icon={ShieldAlert}
            title={t('accessDenied')}
            description={t('activityRestricted', 'Activity tracking is available to managers and admins.')}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopBar title={t('activityDashboard', 'Agent Activity')} />
      <div className="p-6">
        <AgentActivityDashboard active />
      </div>
    </div>
  );
}
