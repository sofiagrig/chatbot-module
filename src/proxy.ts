import { NextResponse, type NextRequest } from "next/server";

// The production site lives at bot.shinaim.biz, behind Cloudflare Access. Requests that reach
// the production deployment through its *.vercel.app address are sent there. (Every page and
// action also verifies the Access token itself, see src/lib/auth.ts, so a request that skips
// Access gets no data either way.)
const CANONICAL_HOST = process.env.CANONICAL_HOST || "bot.shinaim.biz";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (process.env.VERCEL_ENV === "production" && host.endsWith(".vercel.app")) {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${CANONICAL_HOST}`);
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
