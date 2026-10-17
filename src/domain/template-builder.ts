// Turns owner-friendly wording with named placeholders into a Meta template body (US-22 AC5).
// "Hi {{first_name}}, … {{booking_link}}" → body "Hi {{1}}, … {{2}}" + variables [first_name, booking_link].
import { MARKETING_FOOTER } from "./templates";

/** Placeholders shown to owners → message value names the queue fills in. */
const VALUE_NAME: Record<string, string> = { offer: "offer_line" };

export function buildTemplate(wording: string, opts: { marketing: boolean }): { body: string; variables: string[] } {
  const variables: string[] = [];
  const withoutFooter = wording.replace(new RegExp(`\\s*${MARKETING_FOOTER.replace(/\./g, "\\.")}\\s*$`, "i"), "").trim();
  const body = withoutFooter.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => {
    const value = VALUE_NAME[name] ?? name;
    let index = variables.indexOf(value);
    if (index === -1) index = variables.push(value) - 1;
    return `{{${index + 1}}}`;
  });
  return { body: opts.marketing ? `${body} ${MARKETING_FOOTER}` : body, variables };
}

/** The reverse, for showing an existing template in the editor. */
export function templateToWording(body: string, variables: readonly string[]): string {
  const named = Object.fromEntries(Object.entries(VALUE_NAME).map(([k, v]) => [v, k]));
  return body
    .replace(new RegExp(`\\s*${MARKETING_FOOTER.replace(/\./g, "\\.")}$`), "")
    .replace(/\{\{(\d+)\}\}/g, (_, n: string) => `{{${named[variables[Number(n) - 1]] ?? variables[Number(n) - 1]}}}`);
}
