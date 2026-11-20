import { describe, expect, it } from 'vitest';
import {
  Charge,
  ChargeStatus,
  Collection,
  InvalidArgumentError,
  InvoiceStatus,
  normalizePhoneNumber,
  Provider,
} from '@mulla/nodejs';
import { BASE, charge, makeClient } from './helpers.js';

describe('services', () => {
  it('hydrates a charge into a typed model', async () => {
    const { client, fake } = makeClient();
    fake.pushJson(charge({ status: 'SUCCESSFUL', brand_new_field: 'x' }));

    const result = await client.charges.retrieve('9b2e5c1a-7d4f-4a3b-8c6e-1f2a3b4c5d6e');

    expect(result).toBeInstanceOf(Charge);
    expect(result.amount).toBe(5000);
    expect(result.feeAmount).toBe(100);
    expect(result.provider).toBe(Provider.MTN_RW);
    expect(result.status).toBe(ChargeStatus.SUCCESSFUL);
    expect(result.isSuccessful()).toBe(true);
    expect(result.isFinal()).toBe(true);
    expect(result.metadata).toEqual({ order_id: 1001 });
    expect(result.createdAt).toEqual(new Date('2026-11-16T10:00:00.000Z'));
    expect(result.get('brand_new_field')).toBe('x');
    expect(result.raw.brand_new_field).toBe('x');
    expect(JSON.parse(JSON.stringify(result)).brand_new_field).toBe('x');
  });

  it('maps an unknown status to null without breaking', async () => {
    const { client, fake } = makeClient();
    fake.pushJson(charge({ status: 'REFUNDED' }));

    const result = await client.charges.retrieve('abc');

    expect(result.status).toBeNull();
    expect(result.isFinal()).toBe(false);
    expect(result.get('status')).toBe('REFUNDED');
  });

  it('auto-paginates across pages', async () => {
    const { client, fake } = makeClient();
    fake
      .pushJson({ data: [charge({ id: 'a' }), charge({ id: 'b' })], total: 3, page: 1, limit: 2, total_pages: 2 })
      .pushJson({ data: [charge({ id: 'c' })], total: 3, page: 2, limit: 2, total_pages: 2 });

    const page = await client.charges.list({ status: ChargeStatus.PENDING, limit: 2 });
    expect(page).toBeInstanceOf(Collection);
    expect(page.length).toBe(2);
    expect(page.hasMore()).toBe(true);

    const ids: string[] = [];
    for await (const item of page) {
      ids.push(item.id);
    }

    expect(ids).toEqual(['a', 'b', 'c']);
    expect(fake.lastRequest!.url).toBe(`${BASE}/charges?page=2&status=PENDING&limit=2`);
  });

  it('keeps paginating past the second page', async () => {
    const { client, fake } = makeClient();
    for (const page of [1, 2, 3]) {
      fake.pushJson({ data: [charge({ id: `c${page}` })], total: 3, page, limit: 1, total_pages: 3 });
    }

    const ids: string[] = [];
    for await (const item of client.charges.list({ limit: 1 })) {
      ids.push(item.id);
    }

    expect(ids).toEqual(['c1', 'c2', 'c3']);
    expect(fake.lastRequest!.url).toBe(`${BASE}/charges?page=3&limit=1`);
  });

  it('iterates a list call directly, without awaiting it first', async () => {
    const { client, fake } = makeClient();
    fake
      .pushJson({ data: [charge({ id: 'a' })], total: 2, page: 1, limit: 1, total_pages: 2 })
      .pushJson({ data: [charge({ id: 'b' })], total: 2, page: 2, limit: 1, total_pages: 2 });

    const ids: string[] = [];
    for await (const item of client.charges.list({ limit: 1 })) {
      ids.push(item.id);
    }

    expect(ids).toEqual(['a', 'b']);
  });

  it('does not send anything for a list call that is never used', () => {
    const { client, fake } = makeClient();
    void client.charges.list();
    fake.assertNothingSent();
  });

  it('formats date filters', async () => {
    const { client, fake } = makeClient();
    fake.pushJson({ data: [], total: 0, page: 1, limit: 20, total_pages: 0 });

    await client.payouts.list({ startDate: new Date('2026-11-01T00:00:00Z'), endDate: '2026-11-30' });

    expect(fake.lastRequest!.url).toBe(`${BASE}/payouts?start_date=2026-11-01T00%3A00%3A00.000Z&end_date=2026-11-30`);
  });

  it('polls until the charge is final', async () => {
    const { client, fake, sleeps } = makeClient();
    fake
      .pushJson(charge())
      .pushJson(charge())
      .pushJson(charge({ status: 'FAILED', failure_code: 'PAYER_DECLINED' }));

    const result = await client.charges.waitForFinalStatus('abc', { timeoutMs: 60_000, intervalMs: 3000 });

    expect(result.status).toBe(ChargeStatus.FAILED);
    expect(result.failureCode).toBe('PAYER_DECLINED');
    expect(sleeps).toEqual([3000, 3000]);
  });

  it('rejects a polling interval under one second', async () => {
    const { client } = makeClient();
    await expect(client.charges.waitForFinalStatus('abc', { intervalMs: 10 })).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('creates a checkout session and pays it publicly', async () => {
    const { client, fake } = makeClient();
    fake.pushJson({
      id: 'cs_1',
      charge: 'chg_1',
      reference: 'CHG1',
      amount: '5000',
      status: 'PENDING',
      checkout_url: 'https://pay.mulla.test/checkout/charge?id=cs_1&token=tok',
      token: 'tok',
      success_url: 'https://shop.test/ok',
      cancel_url: 'https://shop.test/cancel',
      merchant: { name: 'Shop' },
    });

    const session = await client.charges.createCheckout({
      amount: 5000,
      successUrl: 'https://shop.test/ok',
      cancelUrl: 'https://shop.test/cancel',
    });
    expect(fake.lastBody).toEqual({
      amount: 5000,
      success_url: 'https://shop.test/ok',
      cancel_url: 'https://shop.test/cancel',
    });
    expect(session.token).toBe('tok');
    expect(session.amount).toBe(5000);
    expect(session.charge).toBe('chg_1');
    expect(session.checkoutUrl).toContain('/checkout/charge?id=cs_1');

    fake.pushJson({ id: 'cs_1', status: 'PENDING', provider: 'MTN_RW' });
    await client.checkout.pay('cs_1', 'tok', { provider: Provider.MTN_RW, phoneNumber: '250788000000' });

    expect(fake.lastRequest!.url).toBe(`${BASE}/checkout/cs_1/pay?token=tok`);
    expect(fake.lastBody).toEqual({ provider: 'MTN_RW', phone_number: '+250788000000' });
    expect(client.checkout.eventsUrl('cs_1', 'a+b')).toBe(`${BASE}/checkout/cs_1/events?token=a%2Bb`);
  });

  it('creates an invoice and updates its status', async () => {
    const { client, fake } = makeClient();
    fake.pushJson({ id: 'inv_1', status: 'ISSUED', items: [{ name: 'Consulting', unit_price: 50000, quantity: 2 }] });

    const invoice = await client.invoices.create({
      customer: 'cus_1',
      items: [{ name: 'Consulting', unitPrice: 50000, quantity: 2 }],
      dueDate: new Date('2026-12-01T00:00:00Z'),
    });

    expect(fake.lastBody).toEqual({
      customer: { id: 'cus_1' },
      items: [{ name: 'Consulting', unit_price: 50000, quantity: 2 }],
      due_date: '2026-12-01T00:00:00.000Z',
    });
    expect(invoice.items[0]!.quantity).toBe(2);
    expect(invoice.items[0]!.unitPrice).toBe(50000);

    fake.pushJson({ id: 'inv_1', status: 'CANCELLED' });
    const updated = await client.invoices.updateStatus('inv_1', InvoiceStatus.CANCELLED);
    expect(fake.lastRequest!.method).toBe('PATCH');
    expect(fake.lastBody).toEqual({ status: 'CANCELLED' });
    expect(updated.status).toBe(InvoiceStatus.CANCELLED);
    expect(updated.isFinal()).toBe(true);
  });

  it('checks invoice items field by field', async () => {
    const { client } = makeClient();
    await expect(
      client.invoices.create({ customer: 'cus_1', items: [{ name: 'X', unit_price: 1 } as never] }),
    ).rejects.toThrow(/items\[0\] got unknown field\(s\): unit_price/);
  });

  it('pays an invoice publicly', async () => {
    const { client, fake } = makeClient();
    fake.pushJson({ payment: { id: 'pay_1', status: 'PENDING' }, instructions: 'Approve on your phone' });

    const result = await client.invoices.pay('inv_1', { provider: 'MTN_RW', phoneNumber: '250788000000' });

    expect(fake.lastRequest!.url).toBe(`${BASE}/invoice/inv_1/pay`);
    expect(result.payment!.id).toBe('pay_1');
    expect(result.instructions).toBe('Approve on your phone');
  });

  it('handles both customer field casings', async () => {
    const { client, fake } = makeClient();
    fake.pushJson({ id: 'c1', full_name: 'Aline', companyName: 'Kayko', is_active: true });
    const created = await client.customers.create({ fullName: 'Aline', companyName: 'Kayko' });
    expect(fake.lastBody).toEqual({ full_name: 'Aline', company_name: 'Kayko' });
    expect(created.companyName).toBe('Kayko');

    fake.pushJson({ id: 'c1', full_name: 'Aline', company_name: 'Kayko', is_active: 'true' });
    const customer = await client.customers.retrieve('c1');
    expect(customer.companyName).toBe('Kayko');
    expect(customer.isActive).toBe(true);
  });

  it('uses the webhook endpoint paths', async () => {
    const { client, fake } = makeClient();
    fake.pushJson({ ok: true, status_code: 200, response_body: 'ok', error: null });

    const result = await client.webhookEndpoint.test();

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(fake.lastRequest!.url).toBe(`${BASE}/webhooks/test`);
    expect(fake.lastRequest!.body).toBe('{}');

    fake.pushJson({
      id: 'wh_1',
      url: 'https://shop.test/hook',
      secret: 'whsec',
      is_active: true,
      egress_ips: ['1.2.3.4'],
    });
    const endpoint = await client.webhookEndpoint.create({ url: 'https://shop.test/hook' });
    expect(fake.lastBody).toEqual({ is_active: true, url: 'https://shop.test/hook' });
    expect(endpoint.egressIps).toEqual(['1.2.3.4']);
  });

  it('reads plain array list responses', async () => {
    const { client, fake } = makeClient();
    fake.pushJson([{ code: 'RWF', name: 'Rwandan Franc' }]);

    const currencies = await client.referenceData.currencies();

    expect(currencies.first()!.get('code')).toBe('RWF');
    expect(currencies.hasMore()).toBe(false);
  });

  it('validates reference data filters', async () => {
    const { client } = makeClient();
    await expect(client.referenceData.bankBranches({})).rejects.toThrow(/code or a swift/);
    await expect(client.referenceData.banks({} as never)).rejects.toThrow(/country/);
    await expect(client.invoices.listPayments('..')).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it.each([
    ['250788000000', '+250788000000'],
    ['+250788000000', '+250788000000'],
    ['0788000000', '+250788000000'],
    ['788000000', '+250788000000'],
    ['+250 788 000 000', '+250788000000'],
    ['078-800-0000', '+250788000000'],
    ['+256700000000', '+256700000000'],
    ['12345', '12345'],
  ])('normalizes the phone number %s to %s', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it('sends phone numbers in the +250 format the API requires', async () => {
    const { client, fake } = makeClient();
    fake.pushJson(charge());

    await client.charges.initiate({ provider: Provider.MTN_RW, amount: 100, phoneNumber: '0788000000' });

    expect(fake.lastBody).toMatchObject({ phone_number: '+250788000000' });
  });
});
