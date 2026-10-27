/**
 * @file  packages/shared/test/mail.test.ts
 * @area  Tests
 * @what  Email drivers: console writes the log; smtp (Google Workspace) connects with TLS and the App password from env, and sends the code email.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const sent: any[] = [], configs: any[] = [];
vi.mock('nodemailer', () => ({
  default: { createTransport: (cfg: any) => { configs.push(cfg); return { sendMail: async (m: any) => { sent.push(m); } }; } },
}));

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });

describe('sendMail', () => {
  it('smtp: Gmail over TLS on 465 with the mailbox and its App password', async () => {
    Object.assign(process.env, { MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'admin@example.com', SMTP_PASS: 'app-password', MAIL_FROM: 'PnL Lens <admin@example.com>' });
    const { sendMail, otpEmail } = await import('../src/mail');
    await sendMail({ to: 'trader@example.com', ...otpEmail('123456') });
    expect(configs[0]).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, requireTLS: true, auth: { user: 'admin@example.com', pass: 'app-password' } });
    expect(sent[0]).toMatchObject({ from: 'PnL Lens <admin@example.com>', to: 'trader@example.com', subject: '123456 is your PnL Lens sign-in code' });
    expect(sent[0].html).toContain('123456');
    await sendMail({ to: 'second@example.com', ...otpEmail('654321') });
    expect(configs).toHaveLength(1);                                   // one transport, reused
  });
});

describe('researchInviteEmail', () => {
  it('has both choices on the personal link, the reassurances, and no images or tracking', async () => {
    const { researchInviteEmail } = await import('../src/mail');
    const m = researchInviteEmail('https://pnllens.com/research/consent?t=abc123');
    expect(m.subject).toBe('Help us make PnL Lens better for traders like you');
    expect(m.html).toContain('href="https://pnllens.com/research/consent?t=abc123&amp;choice=yes"');
    expect(m.html).toContain('href="https://pnllens.com/research/consent?t=abc123&amp;choice=no"');
    expect(m.text).toContain('Yes, include my reports: https://pnllens.com/research/consent?t=abc123&choice=yes');
    expect(m.text).toMatch(/name and email removed/); expect(m.text).toMatch(/Nothing changes if you ignore this email/);
    expect(m.html).not.toMatch(/<img|<script|pixel/i);
  });
});
