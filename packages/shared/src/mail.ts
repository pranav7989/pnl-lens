/**
 * @file  packages/shared/src/mail.ts
 * @area  Core
 * @what  Email sender (SMTP / Google Workspace, Resend, Amazon SES, or a local log file) and the email templates (sign-in code, research invite).
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Transactional email. MAIL_DRIVER:
 *   ses     → Amazon SES v2 (default in production; stays on AWS). Needs MAIL_FROM on a verified domain,
 *             SES production access, and the ECS task role allowed ses:SendEmail.
 *   smtp    → any SMTP server; for Google Workspace: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465,
 *             SMTP_USER=<mailbox>, SMTP_PASS=<a Google App password, never the account password>.
 *             MAIL_FROM must be that mailbox or one of its "Send mail as" aliases (Gmail rewrites anything else).
 *   resend  → Resend HTTP API (RESEND_API_KEY)
 *   console → writes to .data/dev-mail.log (local development and e2e tests)
 */
export interface Mail { to: string; subject: string; text: string; html: string }

/** One SMTP connection setup per process (reused for every code email). */
let transport: { sendMail(o: object): Promise<unknown> } | undefined;

export async function sendMail(m: Mail): Promise<void> {
  const driver = process.env.MAIL_DRIVER || (process.env.NODE_ENV === 'production' ? 'ses' : 'console');
  const from = process.env.MAIL_FROM || 'PnL Lens <no-reply@localhost>';

  if (driver === 'console') {
    const file = path.join(process.cwd(), '.data', 'dev-mail.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), from, ...m }) + '\n');
    return;
  }
  if (driver === 'smtp') {
    const nodemailer = (await import('nodemailer')).default;
    transport ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,              // 465 = TLS from the start; 587 = STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      requireTLS: true,
    });
    await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return;
  }
  if (driver === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
    return;
  }
  if (driver === 'ses') {
    const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
    const client = new SESv2Client({ region: process.env.SES_REGION || process.env.AWS_REGION || 'ap-south-1' });
    await client.send(new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [m.to] },
      Content: { Simple: { Subject: { Data: m.subject, Charset: 'UTF-8' }, Body: { Text: { Data: m.text, Charset: 'UTF-8' }, Html: { Data: m.html, Charset: 'UTF-8' } } } },
    }));
    return;
  }
  throw new Error(`Unknown MAIL_DRIVER: ${driver}`);
}

export function otpEmail(code: string): Omit<Mail, 'to'> {
  return {
    subject: `${code} is your PnL Lens sign-in code`,
    text: `Your PnL Lens sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px">
      <div style="font-weight:800;font-size:18px">PnL Lens</div>
      <p style="margin:18px 0 6px;color:#444">Your sign-in code</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:6px;background:#FFD60A;color:#000;padding:12px 16px;border-radius:10px;display:inline-block">${code}</div>
      <p style="color:#666;font-size:13px;margin-top:18px">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The owner's "Request reports" email: asks, once, whether the user's past reports may be included (pseudonymised) to
 * improve PnL Lens. Both buttons open the consent page (the choice is made there, never by opening the email). No
 * tracking pixels, no third-party images.
 */
export function researchInviteEmail(link: string): Omit<Mail, 'to'> {
  const yes = `${link}&choice=yes`, no = `${link}&choice=no`;
  return {
    subject: 'Help us make PnL Lens better for traders like you',
    text: [
      'Hi,',
      '',
      'Thank you for using PnL Lens. Your past reports could help us spot trading patterns more accurately for everyone.',
      '',
      'If you agree, we include the trades and statistics from your reports in the data we use to improve our analysis,',
      'with your name and email removed. It is never sold and never shown to anyone else.',
      '',
      `Yes, include my reports: ${yes}`,
      `No thanks: ${no}`,
      '',
      'Nothing changes if you ignore this email. You can change your choice anytime in Dashboard → Your data.',
      'The link works for 30 days.',
      '',
      'PnL Lens',
    ].join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#222;line-height:1.55">
      <div style="font-weight:800;font-size:18px">PnL Lens</div>
      <p style="margin:18px 0 10px">Hi,</p>
      <p style="margin:0 0 10px">Thank you for using PnL Lens. Your past reports could help us spot trading patterns more accurately for everyone.</p>
      <p style="margin:0 0 18px">If you agree, we include the trades and statistics from your reports in the data we use to improve our analysis, <b>with your name and email removed</b>. It is never sold and never shown to anyone else.</p>
      <a href="${esc(yes)}" style="display:inline-block;background:#FFD60A;color:#000;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Yes, include my reports</a>
      <a href="${esc(no)}" style="display:inline-block;color:#555;text-decoration:underline;padding:12px 14px">No thanks</a>
      <p style="color:#666;font-size:13px;margin-top:20px">Nothing changes if you ignore this email. You can change your choice anytime in Dashboard → Your data. The link works for 30 days.</p></div>`,
  };
}


/** The check-up reminder a user turns on from their 30-day plan (sent once by the worker at 09:00 IST). */
export function planReminderEmail(appUrl: string): Omit<Mail, 'to'> {
  const upload = `${appUrl.replace(/\/$/, '')}/upload`;
  return {
    subject: 'Your 30-day check-up is today',
    text: [
      'Hi,',
      '',
      'It has been 30 days since your PnL Lens plan. Upload this month’s P&L statement or tradebook to see how your numbers moved',
      'and get your next 30-day plan.',
      '',
      `Upload this month’s statement: ${upload}`,
      '',
      'You set this reminder from your 30-day plan. We send it once.',
      '',
      'PnL Lens',
    ].join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#222;line-height:1.55">
      <div style="font-weight:800;font-size:18px">PnL Lens</div>
      <p style="margin:18px 0 10px">Hi,</p>
      <p style="margin:0 0 18px">It has been 30 days since your PnL Lens plan. Upload this month’s P&amp;L statement or tradebook to see how your numbers moved and get your next 30-day plan.</p>
      <a href="${esc(upload)}" style="display:inline-block;background:#FFD60A;color:#000;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Upload this month’s statement</a>
      <p style="color:#666;font-size:13px;margin-top:20px">You set this reminder from your 30-day plan. We send it once.</p></div>`,
  };
}

/** Weekly summary (analysis roadmap B5): opt-in, Mondays; built by apps/api/src/lib/digest.ts. No trade symbols beyond the user's own setup names. */
export interface DigestData {
  reportUrl: string;
  focus: { kind: 'do' | 'dont'; title: string }[];
  journal: { thisWeek: number; total: number; best: string | null };
  checkup: { daysLeft: number; date: string } | null;
  unsubscribeUrl: string;
}
export function weeklyDigestEmail(d: DigestData): Omit<Mail, 'to'> {
  const checkupLine = d.checkup
    ? d.checkup.daysLeft > 0 ? `Your check-up is in ${d.checkup.daysLeft} day${d.checkup.daysLeft === 1 ? '' : 's'} (${d.checkup.date}).` : `Your check-up date (${d.checkup.date}) has come: upload this month's statement to see how your numbers moved.`
    : 'Download your 30-day plan from your latest report to set a check-up date.';
  const journalLine = d.journal.thisWeek
    ? `You wrote ${d.journal.thisWeek} journal note${d.journal.thisWeek === 1 ? '' : 's'} this week (${d.journal.total} in all).`
    : d.journal.total ? `No journal notes this week (${d.journal.total} in all).` : 'Your journal is empty: tag your three biggest trades in the Journal tab.';
  const focus = d.focus.slice(0, 3);
  return {
    subject: focus.length ? `Your week: ${focus.length} rules to keep` : 'Your week on PnL Lens',
    text: [
      'Hi,',
      '',
      ...(focus.length ? ['Your focus this week:', ...focus.map((f) => `- ${f.title}`), ''] : []),
      journalLine + (d.journal.best ? ` ${d.journal.best}` : ''),
      checkupLine,
      '',
      `Open your latest report: ${d.reportUrl}`,
      '',
      `You get this because you turned on the weekly summary. Stop it: ${d.unsubscribeUrl}`,
      'PnL Lens',
    ].join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#222;line-height:1.55">
      <div style="font-weight:800;font-size:18px">PnL Lens</div>
      <p style="margin:18px 0 10px">Hi,</p>
      ${focus.length ? `<p style="margin:0 0 6px;font-weight:700">Your focus this week</p><ul style="margin:0 0 16px;padding-left:20px">${focus.map((f) => `<li style="margin:4px 0">${esc(f.title)}</li>`).join('')}</ul>` : ''}
      <p style="margin:0 0 8px">${esc(journalLine)}${d.journal.best ? ` ${esc(d.journal.best)}` : ''}</p>
      <p style="margin:0 0 18px">${esc(checkupLine)}</p>
      <a href="${esc(d.reportUrl)}" style="display:inline-block;background:#FFD60A;color:#000;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Open my latest report</a>
      <p style="color:#666;font-size:13px;margin-top:20px">You get this because you turned on the weekly summary. <a href="${esc(d.unsubscribeUrl)}" style="color:#666">Stop these emails</a>.</p></div>`,
  };
}
