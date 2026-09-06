import { describe, expect, it } from 'vitest';
import {
  DAY2_NUDGE_AFTER_DAYS,
  TRIAL_EXPIRY_NUDGE_AFTER_DAYS,
  day2NudgeEmail,
  dispatchDueLifecycleEmails,
  trialExpiryNudgeEmail,
  welcomeEmail,
  type LifecycleOutcome,
} from '../src/lib/onboarding/lifecycle.ts';
import { signup } from '../src/lib/auth/service.ts';
import { findWorkspace, setWorkspacePlan } from '../src/lib/repos/accounts.ts';
import {
  findLifecycleEmail,
  listLifecycleEmails,
  setLifecycleEmailsDisabled,
} from '../src/lib/repos/lifecycle.ts';
import type { OutboundEmail, SendResult } from '../src/lib/email.ts';
import type { Db } from '../src/lib/db/index.ts';
import { db, newAccount, onboard, uniqueEmail } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const APP_URL = 'https://app.example';

/** Captures every email handed to the transport; never hits the network. */
function captureSend(): { sent: OutboundEmail[]; send: (email: OutboundEmail) => Promise<SendResult> } {
  const sent: OutboundEmail[] = [];
  const send = async (email: OutboundEmail): Promise<SendResult> => {
    sent.push(email);
    return { via: 'resend', id: `test-${sent.length}` };
  };
  return { sent, send };
}

// Rewinds a workspace's creation date so a nudge window is due.
function rewindCreatedAt(d: Db, workspaceId: string, ms: number): void {
  const ws = findWorkspace(d, workspaceId)!;
  const past = new Date(new Date(ws.createdAt).getTime() - ms).toISOString();
  d.prepare('UPDATE workspaces SET created_at = ? WHERE id = ?').run(past, workspaceId);
}

function outcomesBy(outcomes: LifecycleOutcome[], kind: string): LifecycleOutcome[] {
  return outcomes.filter((o) => o.kind === kind);
}

describe('lifecycle templates (LIN-203)', () => {
  it('welcome: one CTA to the onboarding wizard, transactional footnote', () => {
    const email = welcomeEmail({ to: 'ada@example.com', name: 'Ada Lovelace', workspaceName: 'Acme', appUrl: APP_URL });
    expect(email.to).toBe('ada@example.com');
    expect(email.html).toContain(`${APP_URL}/onboarding`);
    expect(email.html).toContain('Start setup');
    expect(email.text).toContain(`${APP_URL}/onboarding`);
    expect(email.html).not.toContain('unsubscribe'); // transactional, not marketing
  });

  it('day-2 nudge: single resume CTA, no pricing pitch', () => {
    const email = day2NudgeEmail({ to: 'ada@example.com', name: 'Ada Lovelace', workspaceName: 'Acme', appUrl: APP_URL });
    expect(email.subject).toContain('Pick up Acme');
    expect(email.html).toContain('Resume setup');
    expect(email.html).toContain(`${APP_URL}/onboarding`);
    expect(email.html).not.toContain('$');
  });

  it('day-10 expiry nudge: upgrade CTA at the published flat prices', () => {
    const email = trialExpiryNudgeEmail({
      to: 'ada@example.com',
      name: 'Ada Lovelace',
      workspaceName: 'Acme',
      appUrl: APP_URL,
      daysLeft: 4,
    });
    expect(email.subject).toBe('Acme: 4 days left in your trial →');
    expect(email.html).toContain(`${APP_URL}/pricing`);
    expect(email.html).toContain('Choose a plan');
    for (const price of ['$49', '$149', '$399']) expect(email.html).toContain(price);
  });
});

describe('welcome trigger — rides the signup flow', () => {
  it('records a one-shot welcome row on account creation', async () => {
    const d = db();
    const { workspace, user } = await newAccount(d);
    // No transport keys in tests → via 'none', but the row proves the trigger
    // fired exactly once at signup (real runs carry the Resend id's via).
    const row = findLifecycleEmail(d, workspace.id, 'welcome');
    expect(row).not.toBeNull();
    expect(row?.sentAt).toBeTruthy();
    // Idempotent re-signup must not re-trigger the welcome.
    await signup(d, { email: user.email, name: user.name, password: 'another-horse-battery' });
    expect(listLifecycleEmails(d, workspace.id)).toHaveLength(1);
  });
});

describe('day-2 nudge — onboarding incomplete (LIN-203)', () => {
  it('sends once at day 2 to the owner, with the resume CTA', async () => {
    const d = db();
    const { workspace } = await newAccount(d); // onboarding still at step 1
    rewindCreatedAt(d, workspace.id, DAY2_NUDGE_AFTER_DAYS * DAY);
    const cap = captureSend();
    const outcomes = await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, send: cap.send });
    expect(outcomesBy(outcomes, 'day2_nudge')).toEqual([
      { kind: 'day2_nudge', workspaceId: workspace.id, status: 'sent', via: 'resend' },
    ]);
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0].subject).toContain('Pick up');
    expect(findLifecycleEmail(d, workspace.id, 'day2_nudge')?.via).toBe('resend');
  });

  it('is one-shot: a second scan sends nothing', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    rewindCreatedAt(d, workspace.id, 3 * DAY);
    const cap = captureSend();
    await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, send: cap.send });
    await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, send: cap.send });
    expect(cap.sent).toHaveLength(1);
  });

  it('never sends when onboarding completed', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);
    rewindCreatedAt(d, workspace.id, 3 * DAY);
    const cap = captureSend();
    const outcomes = await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, send: cap.send });
    // Complete onboarding means the workspace is not a day-2 candidate at all.
    expect(outcomesBy(outcomes, 'day2_nudge')).toHaveLength(0);
    expect(cap.sent).toHaveLength(0);
  });

  it('never sends before day 2', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    rewindCreatedAt(d, workspace.id, DAY); // 1 day old
    const cap = captureSend();
    const outcomes = await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, send: cap.send });
    expect(outcomesBy(outcomes, 'day2_nudge')).toHaveLength(0);
    expect(cap.sent).toHaveLength(0);
  });
});

describe('day-10 trial-expiry nudge (LIN-203)', () => {
  it('sends at day 10 with the upgrade CTA, regardless of onboarding state', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id); // fully onboarded: only the expiry nudge applies
    rewindCreatedAt(d, workspace.id, TRIAL_EXPIRY_NUDGE_AFTER_DAYS * DAY);
    const cap = captureSend();
    const outcomes = await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, send: cap.send });
    expect(outcomesBy(outcomes, 'trial_expiry_nudge')).toEqual([
      { kind: 'trial_expiry_nudge', workspaceId: workspace.id, status: 'sent', via: 'resend' },
    ]);
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0].subject).toContain('4 days left');
  });

  it('never sends mid-trial or on a paid plan', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id); // keep the day-2 nudge out of this assertion
    rewindCreatedAt(d, workspace.id, 5 * DAY);
    const cap = captureSend();
    expect(outcomesBy(await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, send: cap.send }), 'trial_expiry_nudge')).toHaveLength(0);

    setWorkspacePlan(d, workspace.id, 'starter');
    rewindCreatedAt(d, workspace.id, 10 * DAY); // paid long ago
    expect(outcomesBy(await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, send: cap.send }), 'trial_expiry_nudge')).toHaveLength(0);
    expect(cap.sent).toHaveLength(0);
  });
});

describe('workspace kill switch + dry-run mode (LIN-203)', () => {
  it('kill switch: no email, no row — even after the window opens', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    setLifecycleEmailsDisabled(d, workspace.id, true);
    rewindCreatedAt(d, workspace.id, 10 * DAY);
    const cap = captureSend();
    const outcomes = await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, send: cap.send });
    expect(outcomesBy(outcomes, 'day2_nudge')).toEqual([
      { kind: 'day2_nudge', workspaceId: workspace.id, status: 'skipped', reason: 'kill_switch' },
    ]);
    expect(outcomesBy(outcomes, 'trial_expiry_nudge')).toEqual([
      { kind: 'trial_expiry_nudge', workspaceId: workspace.id, status: 'skipped', reason: 'kill_switch' },
    ]);
    expect(cap.sent).toHaveLength(0);
    expect(listLifecycleEmails(d, workspace.id).filter((r) => r.kind !== 'welcome')).toHaveLength(0);
  });

  it('dry run: logs instead of sends and records via=dry_run', async () => {
    const d = db();
    const { workspace } = await newAccount(d, { email: uniqueEmail() });
    rewindCreatedAt(d, workspace.id, 2 * DAY);
    const cap = captureSend();
    const outcomes = await dispatchDueLifecycleEmails(d, { appUrl: APP_URL, dryRun: true, send: cap.send });
    expect(outcomesBy(outcomes, 'day2_nudge')).toEqual([
      { kind: 'day2_nudge', workspaceId: workspace.id, status: 'dry_run' },
    ]);
    expect(cap.sent).toHaveLength(0); // nothing crossed the wire
    expect(findLifecycleEmail(d, workspace.id, 'day2_nudge')?.via).toBe('dry_run');
    const events = d
      .prepare("SELECT data FROM analytics_events WHERE name = 'lifecycle_email_sent'")
      .all() as { data: string }[];
    expect(events.some((e) => JSON.parse(e.data).kind === 'day2_nudge' && JSON.parse(e.data).dryRun === true)).toBe(true);
  });
});
