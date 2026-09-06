import { buildMetadata } from '@/lib/seo.ts';

// page.tsx is a client component ('use client'), so route metadata lives here.
export const metadata = buildMetadata({
  title: 'Upgrade — Linda',
  description: 'Choose a flat-price plan — from $49/mo, no per-minute billing, cancel any time.',
  path: '/dashboard/upgrade',
});

export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
