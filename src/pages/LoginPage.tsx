import { Link } from "react-router-dom";
import { SignIn } from "@/components/SignIn";
import { TestUserLoginSection } from "@/components/TestUserLoginSection";
import { Button } from "@/components/ui/button";

export function LoginPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/4 size-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 size-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div
            className="text-[11px] font-bold uppercase mb-4"
            style={{ letterSpacing: "2.5px", color: "var(--fdc-gold)" }}
          >
            Frank Data Consultants
          </div>
          <h1 className="text-2xl font-bold tracking-tight">FDC reviewer sign-in</h1>
          <p className="text-muted-foreground text-sm">
            Litmus console — restricted to @frankdataconsultants.com accounts
          </p>
        </div>

        <TestUserLoginSection />
        <SignIn />

        <p className="text-center text-xs text-muted-foreground">
          FDC team without an account?{" "}
          <Button variant="link" className="p-0 h-auto text-xs font-medium" asChild>
            <Link to="/signup">Request reviewer access</Link>
          </Button>
        </p>
      </div>
    </div>
  );
}
