import { useConvexAuth } from "convex/react";
import {
  ArrowRight,
  Check,
  Layers,
  Shield,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function LandingPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <section className="relative flex-1 flex flex-col items-center justify-center px-4 py-16 md:py-24">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-40" />
        </div>

        <div className="max-w-5xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-background text-xs font-medium">
            <Star className="size-3 fill-chart-4 text-chart-4" />
            Badge Text Goes Here
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
            This is the
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-foreground via-foreground/80 to-foreground/60">
              Main Headline
            </span>
          </h1>

          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            This is the subheadline that explains what the product does and why
            it matters. Keep it concise and compelling.
          </p>

          {!isAuthenticated && !isLoading && (
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button size="lg" className="text-base h-11 px-6" asChild>
                <Link to="/signup">
                  Get Started
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="text-base h-11 px-6"
                asChild
              >
                <Link to="/login">Sign In</Link>
              </Button>
            </div>
          )}
          {isAuthenticated && (
            <div className="pt-2">
              <Button size="lg" className="text-base h-11 px-6" asChild>
                <Link to="/dashboard">
                  Go to Dashboard
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          )}

          <div className="flex items-center justify-center gap-6 pt-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Check className="size-4 text-chart-1" />
              <span>Benefit one</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="size-4 text-chart-1" />
              <span>Benefit two</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <Check className="size-4 text-chart-1" />
              <span>Benefit three</span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-32 border-t bg-muted/30">
        <div className="container">
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-muted-foreground mb-3 tracking-wide uppercase">
              Features
            </p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Features Section Title
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg">
              A brief description of what makes this product special and why
              users should care about these features.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-background to-muted/50 border p-6 md:p-8 transition-all hover:shadow-lg hover:border-foreground/20">
              <div className="absolute top-0 right-0 -mt-4 -mr-4 size-24 rounded-full bg-chart-1/10 blur-2xl transition-all group-hover:bg-chart-1/20" />
              <div className="relative">
                <div className="inline-flex size-11 items-center justify-center rounded-xl bg-chart-1/10 mb-5">
                  <Zap className="size-5 text-chart-1" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Feature One</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Here we describe the first key feature. It solves a specific
                  problem for users.
                </p>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-background to-muted/50 border p-6 md:p-8 transition-all hover:shadow-lg hover:border-foreground/20">
              <div className="absolute top-0 right-0 -mt-4 -mr-4 size-24 rounded-full bg-chart-2/10 blur-2xl transition-all group-hover:bg-chart-2/20" />
              <div className="relative">
                <div className="inline-flex size-11 items-center justify-center rounded-xl bg-chart-2/10 mb-5">
                  <Shield className="size-5 text-chart-2" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Feature Two</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  This is where we explain the second feature. It complements
                  the first one.
                </p>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-background to-muted/50 border p-6 md:p-8 transition-all hover:shadow-lg hover:border-foreground/20">
              <div className="absolute top-0 right-0 -mt-4 -mr-4 size-24 rounded-full bg-chart-3/10 blur-2xl transition-all group-hover:bg-chart-3/20" />
              <div className="relative">
                <div className="inline-flex size-11 items-center justify-center rounded-xl bg-chart-3/10 mb-5">
                  <Sparkles className="size-5 text-chart-3" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Feature Three</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  The third feature rounds out the offering. Together they
                  create a solution.
                </p>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-background to-muted/50 border p-6 md:p-8 md:col-span-2 lg:col-span-2 transition-all hover:shadow-lg hover:border-foreground/20">
              <div className="absolute bottom-0 left-0 -mb-8 -ml-8 size-32 rounded-full bg-chart-4/10 blur-2xl transition-all group-hover:bg-chart-4/20" />
              <div className="relative flex flex-col md:flex-row md:items-center gap-6">
                <div className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-chart-4/10">
                  <Layers className="size-7 text-chart-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-2">
                    Feature Four - A Bigger Highlight
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    This larger card can highlight a key differentiator or main
                    value proposition. Use this space to elaborate on what makes
                    your product stand out.
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl bg-primary text-primary-foreground p-6 md:p-8 transition-all hover:shadow-lg">
              <div className="relative">
                <h3 className="font-semibold text-lg mb-2">Ready to start?</h3>
                <p className="text-primary-foreground/80 text-sm leading-relaxed mb-4">
                  Join thousands of users already using our platform.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-background text-foreground hover:bg-background/90"
                  asChild
                >
                  <Link to="/signup">
                    Get Started
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
