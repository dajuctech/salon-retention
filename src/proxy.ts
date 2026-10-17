// Real 404 status before rendering. Pages handle these cases too, but in production the page
// shell streams with 200 before a page can decide, so the decision has to happen here:
//  - public links that don't exist: unknown salon, forged or expired booking link;
//  - staff pages the signed-in member's role may not open, or records outside their reach.
// Signed-out and not-yet-onboarded visitors pass through; the pages redirect them.
// It also gives every request an `x-request-id` (NFR-OBS), so logs and errors can be traced.
import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_SLUGS } from "@/domain/slug";
import { getAuth } from "@/server/auth/auth";
import { ruleFor, staffPageAllowed } from "@/server/auth/page-access";
import { ACTIVE_SALON_COOKIE, actingMember, membershipsFor, pickMembership } from "@/server/auth/session";
import { findSalonBySlug } from "@/server/db";
import { verifyBookingToken } from "@/server/links";

const REQUEST_ID = "x-request-id";

function requestId(request: NextRequest): string {
  const given = request.headers.get(REQUEST_ID);
  return given && /^[\w-]{8,64}$/.test(given) ? given : crypto.randomUUID();
}

/** Continue, passing the request id to the app (headers()) and back to the client. */
function next(request: NextRequest, id: string) {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID, id);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(REQUEST_ID, id);
  return res;
}

function notFound(request: NextRequest, id: string) {
  const res = NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  res.headers.set(REQUEST_ID, id);
  return res;
}

async function staffPage(request: NextRequest, pathname: string, id: string) {
  if (!ruleFor(pathname)) return next(request, id); // ungated: no session lookup needed
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return next(request, id);
  const memberships = await membershipsFor(session.user.id);
  if (memberships.length === 0) return next(request, id);
  const m = pickMembership(memberships, request.cookies.get(ACTIVE_SALON_COOKIE)?.value);
  return (await staffPageAllowed(actingMember(session.user.id, m), pathname)) ? next(request, id) : notFound(request, id);
}

async function publicPage(request: NextRequest, parts: string[], id: string) {
  const [slug, section, token] = parts;
  const salonHome = parts.length === 1 && !slug.includes("."); // a dot means a static file
  const bookingLink = parts.length === 3 && section === "booking";
  if (!(salonHome || bookingLink) || RESERVED_SLUGS.has(slug)) return next(request, id);
  if (bookingLink && !verifyBookingToken(token)) return notFound(request, id);
  const salon = await findSalonBySlug(slug);
  if (!salon || (salonHome && !salon.bookingEnabled)) return notFound(request, id);
  return next(request, id);
}

export async function proxy(request: NextRequest) {
  const id = requestId(request);
  const { pathname } = request.nextUrl;
  // APIs and form posts (server actions) check for themselves; they only get a request id.
  if (pathname.startsWith("/api/") || (request.method !== "GET" && request.method !== "HEAD")) return next(request, id);
  if (pathname.startsWith("/app/")) return staffPage(request, pathname, id);
  return publicPage(request, pathname.split("/").filter(Boolean), id);
}

export const config = {
  // Everything except Next internals and the favicon. Other files and reserved routes are skipped above.
  matcher: ["/((?!_next/|favicon.ico).+)"],
};
