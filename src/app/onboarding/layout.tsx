import { buildMetadata } from '@/lib/seo.ts';

// page.tsx is a client component ('use client'), so route metadata lives here.
export const metadata = buildMetadata({
  title: 'Onboarding — Linda',
  description: 'Set up your AI agent workforce step by step.',
  path: '/onboarding',
});

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
