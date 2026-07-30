import type { NextFunction, Request, Response } from 'express';

/** Production frontends that are owned by this project.
 *
 * Preview deployments must be added explicitly through CORS_ORIGINS.  Do not
 * replace this list with a `*.vercel.app` matcher: an attacker can create their
 * own Vercel deployment and issue credentialed requests from it.
 */
export const KNOWN_PRODUCTION_FRONTENDS = [
  'https://sabt-crm-system-frontend.vercel.app',
] as const;

const LOCAL_DEVELOPMENT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
] as const;

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_COOKIE_NAMES = ['auth_token', 'refresh_token'] as const;

/**
 * Convert a URL to its exact HTTP origin. Invalid values, wildcards and URLs
 * containing credentials are rejected.
 */
export function normalizeHttpOrigin(value: string | undefined | null): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate === '*' || candidate === 'null') return null;

  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '[::1]';
}

/**
 * One source of truth for HTTP CORS, WebSocket CORS and mutation-origin checks.
 * Production never trusts localhost, even when it was accidentally left in env.
 */
export function buildTrustedOrigins(
  env: NodeJS.ProcessEnv = process.env,
  production = env.NODE_ENV === 'production',
): Set<string> {
  const configured = [
    env.FRONTEND_URL,
    ...(env.CORS_ORIGINS || '').split(','),
  ];
  const candidates = [
    ...KNOWN_PRODUCTION_FRONTENDS,
    ...configured,
    ...(!production ? LOCAL_DEVELOPMENT_ORIGINS : []),
  ];

  const origins = new Set<string>();
  for (const candidate of candidates) {
    const origin = normalizeHttpOrigin(candidate);
    if (!origin) continue;
    if (production && isLocalOrigin(origin)) continue;
    origins.add(origin);
  }
  return origins;
}

function requestOrigin(req: Request): string | null {
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host');
  if (!host) return null;

  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  return normalizeHttpOrigin(`${protocol}://${host}`);
}

function sourceOrigin(req: Request): string | null {
  // If Origin is present but malformed/untrusted, do not fall back to Referer.
  const origin = req.get('origin');
  if (origin !== undefined) return normalizeHttpOrigin(origin);

  const referer = req.get('referer');
  return normalizeHttpOrigin(referer);
}

function hasAuthCookie(req: Request): boolean {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  return AUTH_COOKIE_NAMES.some(name => typeof cookies?.[name] === 'string' && cookies[name] !== '');
}

function hasBearerToken(req: Request): boolean {
  return /^Bearer\s+\S+$/i.test(req.get('authorization') || '');
}

/**
 * CSRF-style origin guard for cookie-authenticated mutations.
 *
 * - Read-only requests are unaffected.
 * - Public callbacks/webhooks without auth cookies are unaffected.
 * - Mobile/server clients using Authorization: Bearer are unaffected.
 * - Browser mutations authenticated by SameSite=None cookies must come from an
 *   explicitly trusted frontend (or the API's own exact origin).
 */
export function createStateChangingOriginGuard(trustedOrigins: ReadonlySet<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) return next();
    if (hasBearerToken(req) || !hasAuthCookie(req)) return next();

    const source = sourceOrigin(req);
    const sameOrigin = requestOrigin(req);
    if (source && (trustedOrigins.has(source) || source === sameOrigin)) return next();

    res.status(403).json({
      statusCode: 403,
      message: 'State-changing request rejected: untrusted origin',
      error: 'Forbidden',
    });
  };
}
