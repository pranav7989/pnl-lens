/**
 * @file  components/DeleteReportButton.tsx
 * @area  Reports
 * @what  Delete-report button with confirmation.
 */
'use client';
import { useRouter } from 'next/navigation';

export default function DeleteReportButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button className="linkbtn" onClick={async () => {
      if (!confirm('Delete this report permanently?')) return;
      const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    }}>Delete</button>
  );
}
