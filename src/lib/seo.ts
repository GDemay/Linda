import type { Metadata } from 'next';

// LIN-107: sitewide Open Graph / Twitter Card layer. One helper so every
// route emits the complete tag set (og:title, og:description, og:url,
// og:image, twitter:card) with per-page copy, instead of hand-rolled
// metadata objects that drifted per route.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://linda-llm-production.up.railway.app';
export const SITE_NAME = 'Linda';
export const OG_IMAGE_PATH = '/og-image.png';

export function buildMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: 'en_US',
      type: 'website',
      images: [
        {
          url: OG_IMAGE_PATH,
          width: 1200,
          height: 630,
          alt: `${title}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [OG_IMAGE_PATH],
    },
  };
}
