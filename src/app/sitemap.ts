import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo.ts';

// LIN-206: sitemap completeness. Every public marketing/legal route is listed;
// authenticated surfaces (/dashboard, /onboarding) and API routes are excluded
// on purpose. lastModified is the deploy time — content pages revalidate
// hourly, so the build timestamp is the honest value.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const route = (path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  });

  return [
    route('/', 1.0, 'weekly'),
    route('/pricing', 0.9, 'monthly'),
    route('/virtual-assistant-alternative', 0.8, 'monthly'),
    route('/build', 0.7, 'daily'),
    route('/changelog', 0.7, 'weekly'),
    route('/trust', 0.6, 'monthly'),
    route('/signup', 0.6, 'monthly'),
    route('/login', 0.2, 'yearly'),
    route('/privacy', 0.2, 'yearly'),
    route('/terms', 0.2, 'yearly'),
  ];
}
