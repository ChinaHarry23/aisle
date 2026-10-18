import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { storeAuthorizationCode } from "@/lib/retail/whichgrocer/connection";
import {
  OAUTH_COOKIE,
  issuerMatches,
  oauthCookieOptions,
  readOauthState,
  whichgrocerSettingsUrl,
} from "@/lib/retail/whichgrocer/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function finish(request: NextRequest, status: string, message?: string) {
  const response = NextResponse.redirect(whichgrocerSettingsUrl(request.url, status, message));
  response.cookies.set(OAUTH_COOKIE, "", { ...oauthCookieOptions(), maxAge: 0 });
  return response;
}

/** WhichGrocer returns here after the founder signs in. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (oauthError) return finish(request, "error", oauthError);
  if (!issuerMatches(url.searchParams.get("iss"))) {
    return finish(request, "error", "WhichGrocer returned an unexpected sign-in response.");
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const pending = await readOauthState(request.cookies.get(OAUTH_COOKIE)?.value ?? "");
  if (!pending || pending.state !== state || pending.uid !== user.id || !code) {
    return finish(request, "error", "WhichGrocer sign-in was interrupted. Connect it again.");
  }

  try {
    await storeAuthorizationCode({
      userId: user.id,
      code,
      verifier: pending.verifier,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
    });
    return finish(request, "connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "WhichGrocer did not finish signing in.";
    return finish(request, "error", message);
  }
}
