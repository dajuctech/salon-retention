// Better Auth HTTP endpoints (sign-in, sign-out, OTP, session).
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
