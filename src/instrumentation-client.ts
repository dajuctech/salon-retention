// Browser error reporting (NFR-OBS), only when NEXT_PUBLIC_SENTRY_DSN is set. The SDK is loaded
// lazily so it never adds to the booking page's JavaScript budget otherwise (NFR-P1).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) =>
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      tracesSampleRate: 0.05,
      // No personal data: no user info, cookies, headers, query strings or bodies (security-privacy.md).
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    }),
  );
}
