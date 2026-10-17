// Server start-up and error reporting (NFR-OBS). Sentry is enabled only when SENTRY_DSN is set.
import type { Instrumentation } from "next";

export async function register() {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // No personal data leaves for Sentry: no user info, cookies, headers, query strings, bodies,
    // database values or AI inputs/outputs (security-privacy.md). Our logger redacts the rest.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
    },
  });
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log } = await import("@/server/log");
  const requestId = request.headers["x-request-id"];
  // log.error also forwards to Sentry; only the path (no query string) is logged.
  log.error("request.failed", err, {
    requestId: Array.isArray(requestId) ? requestId[0] : requestId,
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    kind: context.routeType,
    digest: typeof err === "object" && err && "digest" in err ? String(err.digest) : undefined,
  });
};
