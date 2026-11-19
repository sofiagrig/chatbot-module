import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "./db";

// Identity comes from Cloudflare Access, which already checked the person's email with a
// one-time code. Access adds a signed token to every request (Cf-Access-Jwt-Assertion header,
// also the CF_Authorization cookie); we verify its signature, issuer and audience on every
// request, so a request that reaches Vercel without passing Access (e.g. *.vercel.app) is
// refused. There is no separate login.

export type Role = "admin" | "topic_owner" | "user";
export type User = { email: string; role: Role };

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function accessConfig() {
  const team = process.env.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = process.env.CF_ACCESS_AUD?.trim();
  if (!team || !aud) return null;
  jwks ??= createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
  return { issuer: `https://${team}`, aud, jwks };
}

async function verifiedEmail(): Promise<string | null> {
  // Read the request first: this also keeps every page dynamic (never prerendered at build).
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  if (process.env.NODE_ENV === "development" && process.env.DEV_USER_EMAIL) {
    return process.env.DEV_USER_EMAIL.trim().toLowerCase();
  }
  const config = accessConfig();
  if (!config) return null;
  const token = requestHeaders.get("cf-access-jwt-assertion") ?? cookieStore.get("CF_Authorization")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, config.jwks, { issuer: config.issuer, audience: config.aud });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

async function roleOf(email: string): Promise<Role> {
  const bootstrap = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (bootstrap.includes(email)) return "admin";
  const [row] = await db()<{ role: Role }[]>`select role from chatbot.roles where email = ${email}`;
  return row?.role ?? "user";
}

/** The person making this request, or null when Cloudflare Access did not vouch for them. */
export const getUser = cache(async (): Promise<User | null> => {
  const email = await verifiedEmail();
  if (!email) return null;
  return { email, role: await roleOf(email) };
});

export class AccessDenied extends Error {}

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) throw new AccessDenied("not signed in through Cloudflare Access");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AccessDenied("admin only");
  return user;
}
