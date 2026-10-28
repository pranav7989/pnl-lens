/**
 * @file  packages/shared/test/payments.test.ts
 * @area  Tests
 * @what  Razorpay checkout and webhook signature verification.
 */
/** Razorpay signature checks (values computed independently with node:crypto). */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyCheckout, verifyWebhook, parseWebhook } from '../src/payments/razorpay';

describe('razorpay signatures', () => {
  const secret = 'test_key_secret', wh = 'whsec_test';
  it('accepts a valid checkout signature and rejects tampering', () => {
    const sig = crypto.createHmac('sha256', secret).update('order_ABC|pay_XYZ').digest('hex');
    expect(verifyCheckout('order_ABC', 'pay_XYZ', sig, secret)).toBe(true);
    expect(verifyCheckout('order_ABC', 'pay_OTHER', sig, secret)).toBe(false);
    expect(verifyCheckout('order_ABC', 'pay_XYZ', sig, '')).toBe(false);
  });
  it('verifies webhook bodies byte-for-byte', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } });
    const sig = crypto.createHmac('sha256', wh).update(body).digest('hex');
    expect(verifyWebhook(body, sig, wh)).toBe(true);
    expect(verifyWebhook(body + ' ', sig, wh)).toBe(false);
    expect(verifyWebhook(body, null, wh)).toBe(false);
    expect(parseWebhook(JSON.parse(body))).toEqual({ event: 'payment.captured', orderId: 'order_1', paymentId: 'pay_1' });
  });
});
