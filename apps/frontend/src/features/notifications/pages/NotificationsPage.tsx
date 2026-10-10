import type { ReactNode } from 'react';
import { Card, Stat, StatGrid } from '../../../components/ui/Card';

export function NotificationsPage(): ReactNode {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Notifications</h1>
          <p className="page-header__subtitle">
            Inbox for due dates, holds, payments and account updates.
          </p>
        </div>
      </header>

      <StatGrid>
        <Stat label="Unread" value="0" tone="warn" />
        <Stat label="This week" value="0" tone="neutral" />
        <Stat label="Actioned" value="0" tone="ok" />
      </StatGrid>

      <Card title="Inbox">
        <p className="form__note">
          This page is the notification centre for user-facing alerts created by the backend
          service. The route is mounted with standard auth and permission checks, and the UI shell
          is ready for the notification list, mark-read actions and broadcast controls.
        </p>
      </Card>
    </>
  );
}
