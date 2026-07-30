import type { NextFunction, Request, Response } from 'express';
import {
  buildTrustedOrigins,
  createStateChangingOriginGuard,
  KNOWN_PRODUCTION_FRONTENDS,
  normalizeHttpOrigin,
} from './trusted-origins';

function request(
  method: string,
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {},
): Request {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    method,
    cookies,
    protocol: 'https',
    get: (name: string) => normalizedHeaders[name.toLowerCase()],
  } as unknown as Request;
}

function response() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
}

describe('trusted origins', () => {
  it('normalizes only concrete HTTP(S) origins', () => {
    expect(normalizeHttpOrigin(' https://Example.com/app?q=1 ')).toBe('https://example.com');
    expect(normalizeHttpOrigin('*')).toBeNull();
    expect(normalizeHttpOrigin('null')).toBeNull();
    expect(normalizeHttpOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeHttpOrigin('https://user:pass@example.com')).toBeNull();
  });

  it('uses exact configured origins and never trusts arbitrary Vercel deployments', () => {
    const origins = buildTrustedOrigins({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://crm.example.com',
      CORS_ORIGINS: 'https://approved-preview.vercel.app,https://app.example.com',
    });

    expect(origins.has(KNOWN_PRODUCTION_FRONTENDS[0])).toBe(true);
    expect(origins.has('https://crm.example.com')).toBe(true);
    expect(origins.has('https://approved-preview.vercel.app')).toBe(true);
    expect(origins.has('https://attacker-preview.vercel.app')).toBe(false);
  });

  it('never trusts local origins in production', () => {
    const origins = buildTrustedOrigins({
      NODE_ENV: 'production',
      FRONTEND_URL: 'http://localhost:5173',
      CORS_ORIGINS: 'http://127.0.0.1:3000',
    });

    expect([...origins].some(origin => origin.includes('localhost'))).toBe(false);
    expect([...origins].some(origin => origin.includes('127.0.0.1'))).toBe(false);
  });

  it('adds local origins only outside production', () => {
    const origins = buildTrustedOrigins({ NODE_ENV: 'development' });
    expect(origins.has('http://localhost:5173')).toBe(true);
    expect(origins.has('http://127.0.0.1:3000')).toBe(true);
  });
});

describe('state-changing origin guard', () => {
  const trustedOrigins = new Set(['https://crm.example.com']);
  const guard = createStateChangingOriginGuard(trustedOrigins);

  function run(req: Request) {
    const res = response();
    const next = jest.fn() as NextFunction;
    guard(req, res, next);
    return { res, next };
  }

  it('does not affect read-only requests', () => {
    const { next } = run(request('GET', {}, { auth_token: 'cookie-jwt' }));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows mobile/server mutations authenticated with Bearer', () => {
    const { next } = run(request('POST', { authorization: 'Bearer mobile-jwt' }, { auth_token: 'cookie-jwt' }));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not block public callbacks and login requests without auth cookies', () => {
    const { next } = run(request('POST'));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows a cookie-authenticated mutation from an exact trusted Origin', () => {
    const { next } = run(request('PATCH', { origin: 'https://crm.example.com' }, { auth_token: 'cookie-jwt' }));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows Referer fallback and normalizes its path to an origin', () => {
    const { next } = run(request(
      'DELETE',
      { referer: 'https://crm.example.com/finance/transactions' },
      { refresh_token: 'refresh-cookie' },
    ));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows a cookie-authenticated same-origin mutation', () => {
    const { next } = run(request(
      'POST',
      { origin: 'https://api.example.com', host: 'api.example.com' },
      { auth_token: 'cookie-jwt' },
    ));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted browser origin', () => {
    const { res, next } = run(request(
      'POST',
      { origin: 'https://attacker.vercel.app' },
      { auth_token: 'cookie-jwt' },
    ));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Forbidden' }));
  });

  it('rejects a cookie-authenticated mutation without Origin or Referer', () => {
    const { res, next } = run(request('POST', {}, { auth_token: 'cookie-jwt' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
