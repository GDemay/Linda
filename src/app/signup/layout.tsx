import { buildMetadata } from '@/lib/seo.ts';

// page.tsx is a client component ('use client'), so route metadata lives here.
// Title follows the sitewide `Page — Linda` convention (LIN-107).
export const metadata = buildMetadata({
  title: 'Sign up — Linda',
  description:
    'Create your Linda workspace in minutes — hire AI agents for calls, marketing, sales, finance, legal and hiring. No sales call, no demo booking.',
  path: '/signup',
});

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
