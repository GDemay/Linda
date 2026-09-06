import type { Metadata } from 'next';
import { PRICING_TIERS } from './pricing.ts';

// LIN-107: sitewide Open Graph / Twitter Card layer. One helper so every
// route emits the complete tag set (og:title, og:description, og:url,
// og:image, twitter:card) with per-page copy, instead of hand-rolled
// metadata objects that drifted per route.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://linda-llm-production.up.railway.app';
export const SITE_NAME = 'Linda';
export const OG_IMAGE_PATH = '/og-image.png';

// LIN-206: JSON-LD structured data. Same rule as buildMetadata — one place,
// every fact sourced from the repo (pricing.ts for numbers, this file for
// site identity). Nothing invented for crawlers: the Product offers are the
// published $49/$149/$399 tiers, not aspirational pricing.
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}${OG_IMAGE_PATH}`,
    description:
      'Linda gives small teams a workforce of AI agents for prospecting, marketing, SEO, screening, and admin. 100% self-serve.',
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
  };
}

/** Product with one Offer per published tier — prices come from pricing.ts. */
export function productJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Linda',
    description:
      'A workforce of AI agents for small teams — prospecting, marketing, SEO, screening, and admin work. Flat monthly pricing, no per-minute billing, 14-day free trial without a credit card.',
    url: `${SITE_URL}/pricing`,
    image: `${SITE_URL}${OG_IMAGE_PATH}`,
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers: PRICING_TIERS.map((tier) => ({
      '@type': 'Offer',
      name: `${SITE_NAME} ${tier.name} (${tier.seats} seat${tier.seats > 1 ? 's' : ''}, ${tier.monthlyCredits.toLocaleString('en-US')} credits/mo)`,
      price: tier.monthlyUsd.toFixed(2),
      priceCurrency: 'USD',
      url: `${SITE_URL}/pricing`,
      itemCondition: 'https://schema.org/NewCondition',
      availability: 'https://schema.org/InStock',
    })),
  };
}

/** Build-in-public log as a Blog with one BlogPosting per published entry. */
export function buildLogJsonLd(entries: { date: string; title: string; body: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Linda build log',
    url: `${SITE_URL}/build`,
    description:
      'Building 8 autonomous AI employees in public — 3x a week, real numbers, honest friction.',
    // Anchor scheme matches the page: #post-N, newest first (several launch
    // posts share the 2026-09-06 date, so a date anchor would collide).
    blogPost: entries.map((entry, i) => ({
      '@type': 'BlogPosting',
      headline: entry.title,
      datePublished: entry.date,
      url: `${SITE_URL}/build#post-${i + 1}`,
      articleBody: entry.body,
    })),
  };
}

/** Changelog as a WebPage with a dated ItemList prospects can skim. */
export function changelogJsonLd(entries: { date: string; title: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Linda changelog',
    url: `${SITE_URL}/changelog`,
    description: 'What shipped in Linda, and when.',
    mainEntity: {
      '@type': 'ItemList',
      // Anchor scheme matches the page: #entry-N, newest first. A date
      // anchor would collide — several entries share a ship date.
      itemListElement: entries.map((entry, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: entry.title,
        url: `${SITE_URL}/changelog#entry-${i + 1}`,
      })),
    },
  };
}

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
