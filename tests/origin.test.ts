import { afterEach, describe, expect, it } from 'vitest';
import { publicOrigin } from '../src/lib/http.ts';

const internal = 'https://localhost:8080/api/auth/magic-link';

function req(headers: Record<string, string> = {}): Request {
  return new Request(internal, { headers });
}

describe('publicOrigin', () => {
  const original = process.env.APP_ORIGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = original;
  });

  it('falls back to the request URL when no proxy headers are present', () => {
    expect(publicOrigin(req())).toBe('https://localhost:8080');
  });

  it('prefers forwarded host/proto behind a proxy (Railway)', () => {
    const r = req({ 'x-forwarded-host': 'linda-llm-production.up.railway.app', 'x-forwarded-proto': 'https' });
    expect(publicOrigin(r)).toBe('https://linda-llm-production.up.railway.app');
  });

  it('APP_ORIGIN overrides everything, trailing slash normalized', () => {
    process.env.APP_ORIGIN = 'https://linda.example.com/';
    const r = req({ 'x-forwarded-host': 'ignored.example.com', 'x-forwarded-proto': 'http' });
    expect(publicOrigin(r)).toBe('https://linda.example.com');
  });

  it('forwarded proto falls back to the URL protocol when absent', () => {
    const r = req({ 'x-forwarded-host': 'linda-llm-production.up.railway.app' });
    expect(publicOrigin(r)).toBe('https://linda-llm-production.up.railway.app');
  });
});
