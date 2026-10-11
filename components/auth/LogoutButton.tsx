/**
 * @file  components/auth/LogoutButton.tsx
 * @area  Auth
 * @what  Log-out button.
 */
'use client';
import { useRouter } from 'next/navigation';
export default function LogoutButton() {
  const router = useRouter();
  return <button className="btn ghost" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login'); router.refresh(); }}>Log out</button>;
}
