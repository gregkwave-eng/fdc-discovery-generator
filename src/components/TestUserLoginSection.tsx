import { useAuthActions } from "@convex-dev/auth/react";
import { FlaskConical, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";

const TEST_USER = {
  email: "agent-d7887d00@test.local",
  password: "5MjH18kcbn6IEGFbneEKDiS7LRNEj2G0",
  name: "Test Agent",
} as const;

// Whether this is a non-production deployment where the one-click test-reviewer
// login should appear. The Viktor-Spaces preview build doesn't reliably inject
// VITE_IS_PREVIEW, so we also detect the preview at runtime: Viktor-Spaces
// preview deployments are served from a `preview-`-prefixed host, and localhost
// covers local dev. Production (no `preview-` prefix) returns false, and the
// test user only exists in the dev Convex DB regardless — so this is safe.
function isPreviewDeployment(): boolean {
  if (import.meta.env.VITE_IS_PREVIEW === "true") return true;
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h.startsWith("preview-") || h === "localhost" || h === "127.0.0.1";
}

export function TestUserLoginSection() {
  const { signIn } = useAuthActions();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isPreviewDeployment()) {
    return null;
  }

  const handleTestLogin = async () => {
    setError("");
    setLoading(true);

    const formData = new FormData();
    formData.set("email", TEST_USER.email);
    formData.set("password", TEST_USER.password);
    formData.set("flow", "signIn");

    try {
      await signIn("test", formData);
    } catch {
      formData.set("flow", "signUp");
      formData.set("name", TEST_USER.name);
      try {
        await signIn("test", formData);
      } catch {
        setError("Failed to sign in as test user. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="rounded-xl border-2 border-dashed border-warning/30 bg-warning/5 p-4">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-warning flex items-center justify-center shrink-0">
            <FlaskConical className="size-4 text-warning-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Preview Mode</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sign in instantly to explore the app
            </p>
          </div>
        </div>
        <Button
          onClick={handleTestLogin}
          disabled={loading}
          className="w-full mt-3 bg-warning text-warning-foreground hover:bg-warning/90"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          {loading ? "Signing in..." : "Continue as Test User"}
        </Button>
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
      </div>

      <div className="relative py-4">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 text-xs text-muted-foreground">
          or continue with email
        </span>
      </div>
    </>
  );
}
