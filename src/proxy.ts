import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

function isPublicPath(pathname: string) {
  // The landing page; the page itself shows the dashboard instead when signed in.
  if (pathname === "/") return true;
  if (pathname === "/login" || pathname === "/signup") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  // Stripe calls this without a session cookie. The route verifies the
  // Stripe-Signature header against STRIPE_WEBHOOK_SECRET, so that check is
  // the authentication.
  if (pathname === "/api/stripe/webhook") return true;
  // Storage health must be readable when sign-in is what is broken. On a hosted
  // install it tells an anonymous caller only whether storage answered.
  if (pathname === "/api/health") return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await readSession(token) : null;
  const publicPath = isPublicPath(pathname);

  if (!user && !publicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
