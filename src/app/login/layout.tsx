import { buildMetadata } from '@/lib/seo.ts';

// page.tsx is a client component ('use client'), so route metadata lives here.
export const metadata = buildMetadata({
  title: 'Log in — Linda',
  description: 'Log in to your Linda workspace and check in on your AI coworkers.',
  path: '/login',
});

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
