/**
 * Outbound transactional email (LIN-67). Resend is the primary transport;
 * AgentMail is the fallback — the Resend test domain (resend.dev) can only
 * deliver to the account owner, so without a verified domain most recipient
 * addresses are rejected there and AgentMail carries production traffic.
 * Sending never throws: auth flows log the outcome and carry on, because a
 * mail outage must not take signup or login down with it.
 */

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendResult = { via: 'resend' | 'agentmail' | 'none'; id?: string };

const RESEND_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM ?? 'Linda <onboarding@resend.dev>';
const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY;
const AGENTMAIL_FROM = process.env.AGENTMAIL_FROM ?? 'guillaume-5295@agentmail.to';

async function sendViaResend(email: OutboundEmail): Promise<SendResult | null> {
  if (!RESEND_KEY) return null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: email.to, subject: email.subject, text: email.text, html: email.html }),
    });
    if (!res.ok) {
      console.error('[linda] resend rejected email', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { id?: string };
    return { via: 'resend', id: data.id };
  } catch (err) {
    console.error('[linda] resend request failed', err);
    return null;
  }
}

async function sendViaAgentMail(email: OutboundEmail): Promise<SendResult | null> {
  if (!AGENTMAIL_KEY) return null;
  try {
    const res = await fetch(`https://api.agentmail.to/v0/inboxes/${AGENTMAIL_FROM}/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AGENTMAIL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: [email.to], subject: email.subject, text: email.text, html: email.html }),
    });
    if (!res.ok) {
      console.error('[linda] agentmail rejected email', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { id?: string };
    return { via: 'agentmail', id: data.id };
  } catch (err) {
    console.error('[linda] agentmail request failed', err);
    return null;
  }
}

export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  return (await sendViaResend(email)) ?? (await sendViaAgentMail(email)) ?? { via: 'none' };
}

/**
 * One-CTA email body in the audit's dark/indigo visual system (#4f46e5
 * button, white text). Subject and copy come from LIN-49 fix #1.
 */
export function magicLinkEmail(input: {
  to: string;
  name: string;
  link: string;
  workspaceName: string;
  isNew: boolean;
}): OutboundEmail {
  const heading = input.isNew
    ? `Your ${input.workspaceName} workspace is live`
    : `Here's your sign-in link`;
  const cta = 'Continue to workspace';
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#0b0d12;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:480px;background:#12151d;border:1px solid #232838;border-radius:14px;padding:36px;">
      <tr><td style="color:#e7eaf2;font-size:20px;font-weight:700;padding-bottom:6px;">Linda</td></tr>
      <tr><td style="color:#e7eaf2;font-size:22px;font-weight:600;line-height:1.35;padding:10px 0 4px;">Hi ${input.name}, ${heading}.</td></tr>
      <tr><td style="color:#9aa3b5;font-size:15px;line-height:1.6;padding-bottom:26px;">
        Bookmark this email — the button below always takes you straight back to your workspace. The link is single-use and expires in 15 minutes; you can get a fresh one any time from the login page.
      </td></tr>
      <tr><td align="center" style="padding-bottom:26px;">
        <a href="${input.link}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 34px;border-radius:10px;">${cta} &rarr;</a>
      </td></tr>
      <tr><td style="color:#6b7385;font-size:13px;line-height:1.6;">
        If the button doesn't work, paste this link into your browser:<br>
        <a href="${input.link}" style="color:#818cf8;word-break:break-all;">${input.link}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = `Hi ${input.name}, ${heading}.\n\n${cta}: ${input.link}\n\nThe link is single-use and expires in 15 minutes; get a fresh one any time from the login page.`;
  const subject = input.isNew ? 'Your Linda workspace is live →' : 'Your Linda sign-in link →';
  return { to: input.to, subject, text, html };
}
