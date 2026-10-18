import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { clientForRedirect } from "@/lib/retail/whichgrocer/connection";
import {
  OAUTH_COOKIE,
  authorizeUrl,
  oauthCookieOptions,
  pkcePair,
  signOauthState,
  whichgrocerSettingsUrl,
} from "@/lib/retail/whichgrocer/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send the founder to WhichGrocer's sign-in page for the MCP connector. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const redirectUri = new URL("/api/whichgrocer/callback", request.url).toString();
  try {
    const { metadata, client } = await clientForRedirect(redirectUri);
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(24).toString("base64url");
    const token = await signOauthState({
      state,
      verifier,
      redirectUri,
      clientId: client.clientId,
      uid: user.id,
    });
    const response = NextResponse.redirect(
      authorizeUrl({
        metadata,
        clientId: client.clientId,
        redirectUri,
        state,
        challenge,
      }),
    );
    response.cookies.set(OAUTH_COOKIE, token, oauthCookieOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WhichGrocer sign-in could not be started.";
    return NextResponse.redirect(whichgrocerSettingsUrl(request.url, "error", message));
  }
}
