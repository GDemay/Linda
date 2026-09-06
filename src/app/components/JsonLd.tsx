// LIN-206: renders one schema.org object as a <script type="application/ld+json">
// tag. Data is built by the jsonLd* helpers in src/lib/seo.ts so every route
// emits the same facts.
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
