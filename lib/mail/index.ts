/**
 * @file  lib/mail/index.ts
 * @area  Core
 * @what  Email sender: Resend (DigitalOcean), Amazon SES, or a local log file.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Transactional email. MAIL_DRIVER:
 *   ses     → Amazon SES v2 (default in production; stays on AWS). Needs MAIL_FROM on a verified domain,
 *             SES production access, and the ECS task role allowed ses:SendEmail.
 *   resend  → Resend HTTP API (RESEND_API_KEY)
 *   console → writes to .data/dev-mail.log (local development and e2e tests)
 */
export interface Mail { to: string; subject: string; text: string; html: string }

export async function sendMail(m: Mail): Promise<void> {
  const driver = process.env.MAIL_DRIVER || (process.env.NODE_ENV === 'production' ? 'ses' : 'console');
  const from = process.env.MAIL_FROM || 'PnL Lens <no-reply@localhost>';

  if (driver === 'console') {
    const file = path.join(process.cwd(), '.data', 'dev-mail.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), from, ...m }) + '\n');
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
