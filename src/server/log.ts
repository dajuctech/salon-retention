// Structured logging (NFR-OBS): one JSON line per event, personal data redacted, errors also sent
// to Sentry when SENTRY_DSN is set. Use an event name like "dispatch.failed", not a sentence.
import * as Sentry from "@sentry/nextjs";
import { redact } from "@/domain/redact";

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function write(level: Level, event: string, fields: Fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as Fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (process.env.NODE_ENV !== "test") console.info(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  /** Logs and reports to Sentry. `err` is the caught value, if any. */
  error(event: string, err?: unknown, fields: Fields = {}) {
    write("error", event, { ...fields, ...(err === undefined ? {} : { error: err instanceof Error ? err : String(err) }) });
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err ?? new Error(event), { tags: { event }, extra: redact(fields) as Fields });
    }
  },
};
