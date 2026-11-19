import { describe, expect, it } from 'vitest';
import {
  ApiError,
  ApiServerError,
  AuthenticationError,
  ConflictError,
  errorFromResponse,
  IdempotencyError,
  InvalidRequestError,
  MullaError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  Response,
} from '@kayko/mulla-node';
import { caught, makeClient } from './helpers.js';

describe('errorFromResponse', () => {
  it.each([
    [400, 'VALIDATION_FAILED', InvalidRequestError],
    [401, 'API_KEY_INVALID', AuthenticationError],
    [403, 'API_KEY_SCOPE_DENIED', PermissionError],
    [404, 'CHARGE_NOT_FOUND', NotFoundError],
    [409, 'IDEMPOTENCY_KEY_CONFLICT', IdempotencyError],
    [409, 'CHARGE_PAYMENT_IN_PROGRESS', ConflictError],
    [429, 'RATE_LIMIT_EXCEEDED', RateLimitError],
    [502, 'BAD_GATEWAY', ApiServerError],
    [422, 'SOMETHING', ApiError],
  ])('maps %i %s to the right class', (status, code, Class) => {
    const error = errorFromResponse(
      new Response(status, {}, JSON.stringify({ statusCode: status, message: 'msg', errorCode: code })),
    );

    expect(error.constructor).toBe(Class);
    expect(error.name).toBe(Class.name);
    expect(error).toBeInstanceOf(MullaError);
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(status);
    expect(error.errorCode).toBe(code);
  });

  it('adds an actionable hint', () => {
    const error = errorFromResponse(
      new Response(
        403,
        {},
        '{"statusCode":403,"message":"Key environment mismatch","errorCode":"API_KEY_ENVIRONMENT_MISMATCH"}',
      ),
    );
    expect(error.message).toContain('[API_KEY_ENVIRONMENT_MISMATCH] Key environment mismatch — ');
    expect(error.message).toContain('sk_test_');
  });

  it('handles the Nest fallback shape without an errorCode', () => {
    const error = errorFromResponse(
      new Response(404, {}, '{"statusCode":404,"timestamp":"x","path":"/gateway/v1/x","message":["a","b"]}'),
    );
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.errorCode).toBeNull();
    expect(error.message).toBe('a; b');
  });

  it('handles a non-JSON body', () => {
    const error = errorFromResponse(new Response(503, {}, '<html>Bad gateway</html>'));
    expect(error).toBeInstanceOf(ApiServerError);
    expect(error.message).toBe('Mulla API request failed with HTTP 503');
    expect(error.rawBody).toBe('<html>Bad gateway</html>');
  });
});

describe('scope errors', () => {
  it('names the service scope', async () => {
    const { client, fake } = makeClient();
    fake.pushError(403, 'API_KEY_SCOPE_DENIED', 'API key does not have the required scope');

    const error = (await caught(() => client.payouts.list())) as PermissionError;

    expect(error).toBeInstanceOf(PermissionError);
    expect(error.message.endsWith('Required scope: PAYOUTS.')).toBe(true);
    expect(error.errorCode).toBe('API_KEY_SCOPE_DENIED');
    expect(error.cause).toBeInstanceOf(PermissionError);
  });

  it('prefers the scope the server names', async () => {
    const { client, fake } = makeClient();
    fake.pushError(403, 'API_KEY_SCOPE_DENIED', 'Denied', { requiredScope: 'CUSTOMERS' });

    await expect(client.charges.list()).rejects.toThrow('Required scope: CUSTOMERS.');
  });

  it('names no scope for the webhook endpoint', async () => {
    const { client, fake } = makeClient();
    fake.pushError(403, 'API_KEY_SCOPE_DENIED', 'API key does not have the required scope');

    const error = (await caught(() => client.webhookEndpoint.retrieve())) as PermissionError;

    expect(error.message).not.toContain('Required scope');
  });

  it('leaves other permission errors untouched', async () => {
    const { client, fake } = makeClient();
    fake.pushError(403, 'API_KEY_IP_DENIED', 'IP not allowed');

    const error = (await caught(() => client.charges.list())) as PermissionError;

    expect(error.message).not.toContain('Required scope');
    expect(error.cause).toBeUndefined();
  });
});
