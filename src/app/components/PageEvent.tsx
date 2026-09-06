'use client';

import { useEffect } from 'react';
import type { EventName } from '@/lib/analytics/events.ts';

/**
 * Fire-and-forget page-view beacon (LIN-67 / audit fix #6). Cookieless: the
 * server records the event name and nothing else, so no consent banner is
 * needed and there is no visitor profile to leak.
 */
export function PageEvent({
  name,
}: {
  name: Extract<EventName, 'landing_view' | 'signup_view' | 'login_view' | 'pricing_view' | 'upgrade_view'>;
}) {
  useEffect(() => {
    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      keepalive: true,
    }).catch(() => {});
  }, [name]);
  return null;
}
