/**
 * @file  apps/web/app/(app)/reminders/new/page.tsx
 * @area  Reports
 * @what  "Remind me on <date>" from the 30-day plan PDF: confirms and turns on one check-up email (signs in first if needed).
 */
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api-client';
import ReminderConfirm from '@/components/workspace/ReminderConfirm';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewReminder(props: { searchParams: Promise<{ report?: string; date?: string }> }) {
  const sp = await props.searchParams;
  const date = typeof sp.date === 'string' && ISO.test(sp.date) ? sp.date : '';
  const report = typeof sp.report === 'string' && UUID.test(sp.report) ? sp.report : '';
  const self = `/reminders/new?${new URLSearchParams({ ...(report && { report }), ...(date && { date }) }).toString()}`;
  if (!(await getMe())) redirect(`/login?next=${encodeURIComponent(self)}`);
  return (
    <div className="panel reminder-card" style={{ maxWidth: 520, margin: '24px auto' }}>
      <ReminderConfirm date={date} reportId={report || null} />
    </div>
  );
}
