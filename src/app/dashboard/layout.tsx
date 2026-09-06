import { buildMetadata } from '@/lib/seo.ts';

// page.tsx is a client component ('use client'), so route metadata lives here.
// Authenticated surface — metadata exists for title consistency, not sharing.
export const metadata = buildMetadata({
  title: 'Dashboard — Linda',
  description: 'Your Linda workspace: agents, tasks, approvals and knowledge.',
  path: '/dashboard',
});

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
