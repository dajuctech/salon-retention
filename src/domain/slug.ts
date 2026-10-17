// Public booking links are /{slug}. Slugs must not collide with the app's own routes.

export const RESERVED_SLUGS = new Set([
  "app",
  "api",
  "login",
  "logout",
  "signup",
  "invite",
  "reset-password",
  "admin",
  "settings",
  "help",
  "support",
  "about",
  "terms",
  "privacy",
  "static",
  "public",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
]);

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** First free candidate: base, base-2, base-3, … (`taken` checks the database). */
export async function uniqueSlug(name: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  let base = slugify(name);
  if (base.length < 3 || RESERVED_SLUGS.has(base)) base = `${base || "salon"}-salon`.replace(/^-/, "");
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    if (isValidSlug(candidate) && !(await taken(candidate))) return candidate;
  }
  throw new Error("Could not find a free booking link name");
}
