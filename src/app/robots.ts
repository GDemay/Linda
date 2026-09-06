import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo.ts';

// LIN-206: robots policy. Public marketing pages are crawlable; the app
// surfaces behind login and the API are not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard', '/onboarding', '/api/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
