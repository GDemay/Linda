/**
 * Onboarding lifecycle emails (LIN-203) on the existing Resend transport.
 *
 * A trialist who stalls in onboarding never converts, so three transactional
 * nudges ride the pipes that already exist (zero new accounts, zero budget):
 *
 *   welcome       on signup completion      — one "next step to first value" CTA
 *   day2_nudge    day 2, onboarding stuck   — plain reminder, single resume CTA
 *   trial_expiry_nudge  day 10 of the 14-day trial — upgrade CTA at published prices
 *
 * Transactional only, to signed-up workspaces, never marketing. Each kind is
 * one-shot per workspace (lifecycle_emails table), a workspace-level kill
 * switch exists (`setLifecycleEmailsDisabled`), and LIFECYCLE_EMAIL_DRY_RUN=1
 * logs instead of sending.
 */

import type { Db } from '../db/index.ts';
import { emailShell, sendEmail, type OutboundEmail, type SendResult } from '../email.ts';
import { PRICING_TIERS } from '../pricing.ts';
import { recordEvent } from '../analytics/events.ts';
import { trialEndsAt } from '../billing/entitlements.ts';
import { recordActivity } from '../repos/workflows.ts';
import {
  findWorkspaceOwner,
  listWorkspacesByPlan,
  listWorkspacesIncompleteOnboarding,
} from '../repos/accounts.ts';
import {
  findLifecycleEmail,
  lifecycleEmailsDisabled,
  markLifecycleEmailSent,
  type LifecycleEmailKind,
} from '../repos/lifecycle.ts';
import type { User, Workspace } from '../repos/types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Day-2 nudge fires once the workspace is at least this old (and still stuck). */
export const DAY2_NUDGE_AFTER_DAYS = 2;
/** Trial-expiry nudge fires this many days after signup (trial is 14 days). */
export const TRIAL_EXPIRY_NUDGE_AFTER_DAYS = 10;

type Send = (email: OutboundEmail) => Promise<SendResult>;

export type LifecycleDeliveryOptions = {
  now?: Date;
  /** Log instead of send (prove-out / staging). Defaults to LIFECYCLE_EMAIL_DRY_RUN=1. */
  dryRun?: boolean;
  /** Transport override; tests inject a capture here. */
  send?: Send;
};

export type LifecycleOutcome =
  | { kind: LifecycleEmailKind; workspaceId: string; status: 'sent'; via: string }
  | { kind: LifecycleEmailKind; workspaceId: string; status: 'dry_run' }
  | { kind: LifecycleEmailKind; workspaceId: string; status: 'skipped'; reason: 'already_sent' | 'kill_switch' | 'no_owner' | 'send_failed' };

// ---------------------------------------------------------------- templates

/** Signup welcome — the single next step to first value is the onboarding wizard. */
export function welcomeEmail(input: { to: string; name: string; workspaceName: string; appUrl: string }): OutboundEmail {
  const { html, text } = emailShell({
    heading: `Welcome to ${input.workspaceName}, ${input.name.split(' ')[0]}`,
    paragraphs: [
      'Your workspace is live. One short setup — company profile, pick your goals, hire your first agent — and your team runs its first real workflow. Most people finish in under five minutes.',
    ],
    cta: { label: 'Start setup', url: `${input.appUrl}/onboarding` },
    footnote: ['You are receiving this because you just created a Linda workspace. This is a transactional account email, not a newsletter.'],
  });
  return { to: input.to, subject: `Welcome to Linda — your first run in 5 minutes`, text, html };
}

/** Day-2 reminder for a workspace that never finished onboarding. Plain, single CTA. */
export function day2NudgeEmail(input: { to: string; name: string; workspaceName: string; appUrl: string }): OutboundEmail {
  const { html, text } = emailShell({
    heading: `${input.workspaceName} is waiting where you left off`,
    paragraphs: [
      `Hi ${input.name.split(' ')[0]} — you set up ${input.workspaceName} two days ago and are one step away from your first workflow run. Setup resumes exactly where you stopped.`,
    ],
    cta: { label: 'Resume setup', url: `${input.appUrl}/onboarding` },
    footnote: ['This is a one-time account reminder for your unfinished setup, not a newsletter.'],
  });
  return { to: input.to, subject: `Pick up ${input.workspaceName} where you left off →`, text, html };
}

/**
 * Day-10 trial nudge — meet the upgrade CTA while the workspace still works,
 * at the published flat prices ($49/$149/$399, from lib/pricing.ts).
 */
export function trialExpiryNudgeEmail(input: {
  to: string;
  name: string;
  workspaceName: string;
  appUrl: string;
  daysLeft: number;
}): OutboundEmail {
  const prices = PRICING_TIERS.map((t) => `${t.name} $${t.monthlyUsd}/mo`).join(' · ');
  const { html, text } = emailShell({
    heading: `${input.daysLeft} days left in your ${input.workspaceName} trial`,
    paragraphs: [
      `Hi ${input.name.split(' ')[0]} — your trial ends in ${input.daysLeft} days, and the workspace becomes read-only when it does. Pick a plan before then and your agents keep running without interruption.`,
      `Flat monthly pricing, no per-minute billing: ${prices}.`,
    ],
    cta: { label: 'Choose a plan', url: `${input.appUrl}/pricing` },
    footnote: ['This is a transactional notice about your trial ending, not a newsletter.'],
  });
  return { to: input.to, subject: `${input.workspaceName}: ${input.daysLeft} days left in your trial →`, text, html };
}

// ----------------------------------------------------------------- delivery

/**
 * Sends one lifecycle email, enforcing the invariants: kill switch, one-shot
 * per (workspace, kind), dry-run, never throws. The send row is written even
 * when the transport reports 'none' — an inbox must never see the same nudge
 * twice, and the worker must not become a retry spammer during a mail outage.
 */
async function deliver(
  db: Db,
  workspace: Workspace,
  email: OutboundEmail,
  kind: LifecycleEmailKind,
  opts: LifecycleDeliveryOptions = {},
): Promise<LifecycleOutcome> {
  const base = { kind, workspaceId: workspace.id };
  if (lifecycleEmailsDisabled(db, workspace.id)) {
    return { ...base, status: 'skipped', reason: 'kill_switch' };
  }
  if (findLifecycleEmail(db, workspace.id, kind)) {
    return { ...base, status: 'skipped', reason: 'already_sent' };
  }

  const dryRun = opts.dryRun ?? process.env.LIFECYCLE_EMAIL_DRY_RUN === '1';
  if (dryRun) {
    console.log(`[lifecycle] dry-run ${kind} → ${email.to} "${email.subject}"`);
    markLifecycleEmailSent(db, workspace.id, kind, 'dry_run');
    recordEvent(db, 'lifecycle_email_sent', { workspaceId: workspace.id, kind, via: 'dry_run', dryRun: true });
    return { ...base, status: 'dry_run' };
  }

  const send = opts.send ?? sendEmail;
  const result = await send(email);
  markLifecycleEmailSent(db, workspace.id, kind, result.via);
  recordEvent(db, 'lifecycle_email_sent', { workspaceId: workspace.id, kind, via: result.via, dryRun: false });
  recordActivity(db, {
    workspaceId: workspace.id,
    actorType: 'system',
    kind: 'lifecycle.email_sent',
    summary: `Lifecycle email sent: ${kind}`,
    data: { kind, via: result.via },
  });
  return result.via === 'none'
    ? { ...base, status: 'skipped', reason: 'send_failed' }
    : { ...base, status: 'sent', via: result.via };
}

/** Welcome trigger — called from the signup flow right after account creation. */
export async function sendWelcomeEmail(
  db: Db,
  workspace: Workspace,
  owner: User,
  appUrl: string,
  opts: LifecycleDeliveryOptions = {},
): Promise<LifecycleOutcome> {
  const email = welcomeEmail({ to: owner.email, name: owner.name, workspaceName: workspace.name, appUrl });
  return deliver(db, workspace, email, 'welcome', opts);
}

function ageInDays(workspace: Workspace, now: Date): number {
  return Math.floor((now.getTime() - new Date(workspace.createdAt).getTime()) / DAY_MS);
}

function daysLeftInTrial(workspace: Workspace, now: Date): number {
  return Math.max(0, Math.ceil((new Date(trialEndsAt(workspace)).getTime() - now.getTime()) / DAY_MS));
}

/**
 * Worker tick: scans for due nudges and sends what is due. Returns every
 * candidate's outcome so the worker log shows sends, skips and failures.
 */
export async function dispatchDueLifecycleEmails(
  db: Db,
  opts: { appUrl: string } & LifecycleDeliveryOptions = { appUrl: 'http://localhost:3000' },
): Promise<LifecycleOutcome[]> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? process.env.LIFECYCLE_EMAIL_DRY_RUN === '1';
  const out: LifecycleOutcome[] = [];

  // Day-2 nudge: trialist, onboarding never reached 'done', workspace >= 2 days old.
  for (const ws of listWorkspacesIncompleteOnboarding(db)) {
    if (ws.plan !== 'trial') continue;
    if (ageInDays(ws, now) < DAY2_NUDGE_AFTER_DAYS) continue;
    const owner = findWorkspaceOwner(db, ws.id);
    if (!owner) {
      out.push({ kind: 'day2_nudge', workspaceId: ws.id, status: 'skipped', reason: 'no_owner' });
      continue;
    }
    const email = day2NudgeEmail({ to: owner.email, name: owner.name, workspaceName: ws.name, appUrl: opts.appUrl });
    out.push(await deliver(db, ws, email, 'day2_nudge', { now, dryRun, send: opts.send }));
  }

  // Day-10 trial-expiry nudge: still on the live trial, 10 or more days in.
  for (const ws of listWorkspacesByPlan(db, 'trial')) {
    if (ageInDays(ws, now) < TRIAL_EXPIRY_NUDGE_AFTER_DAYS) continue;
    const owner = findWorkspaceOwner(db, ws.id);
    if (!owner) {
      out.push({ kind: 'trial_expiry_nudge', workspaceId: ws.id, status: 'skipped', reason: 'no_owner' });
      continue;
    }
    const email = trialExpiryNudgeEmail({
      to: owner.email,
      name: owner.name,
      workspaceName: ws.name,
      appUrl: opts.appUrl,
      daysLeft: daysLeftInTrial(ws, now),
    });
    out.push(await deliver(db, ws, email, 'trial_expiry_nudge', { now, dryRun, send: opts.send }));
  }

  return out;
}
