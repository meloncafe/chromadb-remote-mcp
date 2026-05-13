/**
 * Stub for http-proxy-middleware in unit tests.
 *
 * The real package transitively pulls ESM-only dependencies (`httpxy`) that
 * Jest cannot transform in our ts-jest ESM setup. Unit tests target our own
 * helpers (sanitizers, validators, auth, middleware), not the proxy itself —
 * integration tests cover the proxy via docker-compose. Returning a no-op
 * Express middleware here is sufficient to satisfy the import at module load.
 */
import type { Request, Response, NextFunction } from "express";

export function createProxyMiddleware(_options?: unknown) {
  return function noopProxy(_req: Request, _res: Response, next: NextFunction) {
    next();
  };
}
