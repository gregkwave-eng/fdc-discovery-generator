import { useConvexAuth } from "convex/react";
import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "./ui/button";

// FDC-branded header. Litmus is an FDC property, not a standalone SaaS — the
// wordmark mirrors frankdataconsultants.com, and the only nav affordance is a
// discreet FDC-team sign-in (reviewers), never a consumer "Get Started" funnel.
export function Header() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const location = useLocation();
  const isAuthPage =
    location.pathname === "/login" || location.pathname === "/signup";

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="container">
        <div className="flex h-16 items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <span
              className="text-[12px] font-bold uppercase"
              style={{ letterSpacing: "2.5px", color: "var(--fdc-gold)" }}
            >
              Frank Data Consultants
            </span>
            <span className="h-4 w-px bg-border" aria-hidden />
            <span className="text-sm font-semibold tracking-tight">Litmus</span>
          </Link>

          <nav className="flex items-center gap-2">
            {isLoading ? null : isAuthenticated ? (
              <Button size="sm" asChild>
                <Link to="/review">
                  Open reviewer console
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : (
              !isAuthPage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  asChild
                >
                  <Link to="/login">FDC team sign-in</Link>
                </Button>
              )
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
