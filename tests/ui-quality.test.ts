// Programmatic UI-quality gates (LIN-94).
//
// Two layers:
//  1. Formatter invariants — every display formatter must turn any input
//     (valid, missing, malformed) into a human string. Raw ISO timestamps,
//     "Invalid Date", "NaN" and friends must never reach the page.
//  2. Static anti-pattern scan — pages/components must format dates through
//     src/lib/ui/format.ts instead of ad-hoc `new Date(...).toLocale*()`,
//     so a missing value can't silently render "Invalid Date" again.
//
// Rendered-HTML invariants for a live server live in scripts/e2e.sh
// ("UI invariants" step) so they run against the real Next.js output.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  FALLBACK,
  formatCost,
  formatDate,
  formatDateTime,
  formatDurationMs,
  formatTime,
} from '../src/lib/ui/format.ts';

const BAD_LEAKS = ['Invalid Date', 'NaN', 'undefined', 'null'] as const;

function assertHumanString(label: string, out: string): void {
  expect(out.length, `${label} should be non-empty`).toBeGreaterThan(0);
  for (const leak of BAD_LEAKS) {
    expect(out, `${label} leaked "${leak}"`).not.toContain(leak);
  }
  // Raw ISO 8601 (e.g. 2026-09-04T13:28:17.958Z) must never render as-is.
  expect(out, `${label} leaked a raw ISO timestamp`).not.toMatch(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  );
}

describe('formatter invariants (no raw values ever reach the UI)', () => {
  const validInputs: unknown[] = [
    '2026-09-04T13:28:17.958Z',
    1759918097958,
    new Date('2026-01-02T03:04:05Z'),
  ];

  const invalidInputs: unknown[] = [
    undefined,
    null,
    '',
    'not-a-date',
    NaN,
    Number.NaN,
    {},
    [],
  ];

  const dateFormatters = [
    ['formatDateTime', formatDateTime],
    ['formatDate', formatDate],
    ['formatTime', formatTime],
  ] as const;

  for (const [name, fn] of dateFormatters) {
    it(`${name}: formats valid dates as human strings`, () => {
      for (const input of validInputs) {
        const out = fn(input);
        assertHumanString(`${name}(${JSON.stringify(input)})`, out);
        expect(out).not.toBe(FALLBACK);
      }
    });

    it(`${name}: falls back instead of leaking garbage on bad input`, () => {
      for (const input of invalidInputs) {
        const out = fn(input);
        assertHumanString(`${name}(${JSON.stringify(input)})`, out);
        expect(out).toBe(FALLBACK);
      }
    });
  }

  it('formatDurationMs renders compact human durations', () => {
    expect(formatDurationMs(0)).toBe('0s');
    expect(formatDurationMs(86_400)).toBe('1m 26s');
    expect(formatDurationMs(40_000)).toBe('40s');
    expect(formatDurationMs(3_600_000)).toBe('1h');
    expect(formatDurationMs(7_320_000)).toBe('2h 02m');
  });

  it('formatDurationMs falls back on bad input', () => {
    for (const input of [undefined, null, NaN, -5, 'x'] as unknown[]) {
      expect(formatDurationMs(input)).toBe(FALLBACK);
    }
  });

  it('formatCost renders money and falls back on bad input', () => {
    expect(formatCost(0.0041)).toBe('$0.0041');
    expect(formatCost(12.5)).toBe('$12.50');
    for (const input of [undefined, null, NaN, -1, 'x'] as unknown[]) {
      expect(formatCost(input)).toBe(FALLBACK);
    }
  });
});

describe('static anti-pattern scan of src/app', () => {
  function tsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...tsxFiles(full));
      } else if (entry.endsWith('.tsx')) {
        out.push(full);
      }
    }
    return out;
  }

  const files = tsxFiles(join(import.meta.dirname, '..', 'src', 'app'));

  it('scans a non-empty set of pages/components', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no page/component formats dates inline — all dates go through src/lib/ui/format.ts', () => {
    // `new Date(x).toLocaleString()` renders "Invalid Date" when x is
    // missing/malformed, and raw ISO strings leak wherever a formatter is
    // skipped entirely. Both are the bug class from LIN-94's screenshot.
    const offenders = files.filter((f) => /new Date\([^)]*\)\.(toLocale|toISOString)/.test(readFileSync(f, 'utf8')));
    expect(
      offenders.map((f) => f.split('/src/app/')[1]),
      'Move these through src/lib/ui/format.ts so bad values render "—" instead of garbage.',
    ).toEqual([]);
  });

  it('no page/component stringifies objects into JSX', () => {
    // `{JSON.stringify(x)}` renders `[object Object]`-adjacent garbage in the
    // page. Serialization for fetch bodies is fine; rendering it is not.
    const offenders = files.filter((f) => /\{\s*JSON\.stringify/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.split('/src/app/')[1])).toEqual([]);
  });

  it('QA harness toolbar is hard-gated behind NEXT_PUBLIC_QA_HARNESS (LIN-118)', () => {
    // The Journey Spec state-switcher is internal QA tooling. It once shipped
    // to production on /login and /onboarding; this gate makes sure the
    // early-return in StateBar never gets removed.
    const stateBar = readFileSync(join(import.meta.dirname, '..', 'src', 'app', 'components', 'StateBar.tsx'), 'utf8');
    expect(stateBar, 'StateBar must keep the QA_HARNESS_ENABLED flag export').toContain(
      'process.env.NEXT_PUBLIC_QA_HARNESS',
    );
    expect(stateBar, 'StateBar must render nothing when the flag is off').toMatch(
      /if\s*\(!QA_HARNESS_ENABLED\)\s*return null/,
    );
  });

  it('signup footer links the legal pages it references (LIN-121)', () => {
    const signup = readFileSync(join(import.meta.dirname, '..', 'src', 'app', 'signup', 'page.tsx'), 'utf8');
    expect(signup).toContain('href="/terms"');
    expect(signup).toContain('href="/privacy"');
    for (const page of ['terms', 'privacy']) {
      expect(
        existsSync(join(import.meta.dirname, '..', 'src', 'app', page, 'page.tsx')),
        `/${page} page must exist so the footer links resolve`,
      ).toBe(true);
    }
  });
});
