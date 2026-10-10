import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/ui/Card';
import { DescriptionItem, DescriptionList } from '../../../components/ui/Table';
import { useAuth } from '../../../contexts/AuthContext';
import { paths } from '../../../routes/paths';
import { PasswordCard, SessionsCard } from '../components/SecurityCards';

/**
 * Account settings: password, active sessions, and sign-out everywhere.
 *
 * "Where am I signed in?" is the question a person asks after suspecting someone
 * else has their account, so the session list is on the profile rather than hidden
 * in a security page. Revoking is per-session, and the current session is
 * labelled rather than left for the user to identify by timestamp.
 *
 * The two cards live in `components/SecurityCards.tsx` because the settings
 * screen shows the same content; only the surrounding record is specific to
 * this page.
 */
export function ProfilePage(): ReactNode {
  const { session } = useAuth();

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Your profile</h1>
          <p className="page-header__subtitle">
            {session?.email} · {session?.roleCode}
            {session?.branchScope === null && ' · all branches'}
          </p>
        </div>
      </header>

      <div className="grid grid--two">
        <PasswordCard />
        <SessionsCard />
      </div>

      <Card title="Your record">
        <DescriptionList>
          <DescriptionItem term="Email">{session?.email}</DescriptionItem>
          <DescriptionItem term="Role">{session?.roleCode}</DescriptionItem>
          <DescriptionItem term="Branch access">
            {session?.branchScope === null
              ? 'All branches'
              : `${session?.branchScope.length ?? 0} branch(es)`}
          </DescriptionItem>
          <DescriptionItem term="Student record">
            {session?.memberId ? (
              <Link className="link" to={paths.member(session.memberId)}>
                View member record
              </Link>
            ) : (
              'None — staff account'
            )}
          </DescriptionItem>
        </DescriptionList>
      </Card>
    </>
  );
}
