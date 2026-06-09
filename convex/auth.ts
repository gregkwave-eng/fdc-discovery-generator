import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { TestCredentials } from "./testAuth";
import {
  ViktorSpacesEmail,
  ViktorSpacesPasswordReset,
} from "./ViktorSpacesEmail";

declare const process: { env: Record<string, string | undefined> };

// --- /review reviewer allow-list -------------------------------------------
// The only humans who authenticate via Convex Auth are FDC reviewers on the
// /review surface (owners use stateless magic links, not Convex Auth users).
// Enforce a domain allow-list so non-FDC emails cannot create or sign into a
// reviewer account. Runs in the Password provider's `profile`, which is invoked
// on both sign-up and sign-in, so it gates account creation AND login.
const REVIEWER_ALLOWED_DOMAINS = ["frankdataconsultants.com"];

function assertAllowedReviewerEmail(rawEmail: unknown): string {
  const email = String(rawEmail ?? "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1) : "";
  if (!email || at <= 0 || !REVIEWER_ALLOWED_DOMAINS.includes(domain)) {
    throw new ConvexError(
      `Reviewer access is restricted to ${REVIEWER_ALLOWED_DOMAINS.map((d) => "@" + d).join(", ")} accounts.`,
    );
  }
  return email;
}

function decodePrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.includes("\n")) return key;
  if (key.startsWith("-----BEGIN")) {
    return key
      .replace("-----BEGIN PRIVATE KEY----- ", "-----BEGIN PRIVATE KEY-----\n")
      .replace(" -----END PRIVATE KEY-----", "\n-----END PRIVATE KEY-----")
      .split(" ")
      .join("\n");
  }
  try {
    return atob(key);
  } catch {
    return key;
  }
}

const authPrivateKey = process.env.AUTH_PRIVATE_KEY;
if (authPrivateKey) {
  process.env.AUTH_PRIVATE_KEY = decodePrivateKey(authPrivateKey);
}

const jwtPrivateKey = process.env.JWT_PRIVATE_KEY;
if (jwtPrivateKey) {
  process.env.JWT_PRIVATE_KEY = decodePrivateKey(jwtPrivateKey);
}

// Only register the @test.local credentials provider on preview/dev Convex
// deployments. `VIKTOR_SPACES_IS_PREVIEW` is set per-deployment by the Viktor
// Spaces backend (true on dev, false on prod). On production it is "false" or
// unset, so the test provider is omitted entirely and `signIn("test", ...)`
// fails with "Provider not configured".
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      verify: ViktorSpacesEmail,
      reset: ViktorSpacesPasswordReset,
      profile(params) {
        const email = assertAllowedReviewerEmail((params as { email?: unknown }).email);
        return { email };
      },
    }),
    ...(process.env.VIKTOR_SPACES_IS_PREVIEW === "true" ? [TestCredentials] : []),
  ],
});

export const currentUser = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});
