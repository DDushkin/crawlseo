import { signIn, auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="noise-overlay pointer-events-none absolute inset-0" />
      <div
        className="pointer-events-none absolute -left-20 top-0 size-80 rounded-full opacity-40 blur-3xl"
        style={{ background: "var(--a-info-300)" }}
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-10 size-72 rounded-full opacity-30 blur-3xl"
        style={{ background: "var(--a-brand-100)" }}
      />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-3)]">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden>
              <path
                d="M4 18 L12 5 L20 18"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
            </svg>
          </div>
          <h1 className="font-heading text-atom-display1 font-semibold tracking-tight text-foreground">
            CrawlSEO
          </h1>
          <p className="mt-2 text-atom-body text-muted-foreground">
            Self-hosted search ops for founders
          </p>
        </div>

        <div className="panel-elevated p-8">
          <h2 className="font-heading text-atom-title font-semibold text-foreground">
            Sign in
          </h2>
          <p className="mt-2 text-atom-body text-muted-foreground">
            Use Google to connect Search Console. We only request read-only
            access to webmasters data.
          </p>

          <form
            className="mt-6"
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <Button type="submit" size="lg" className="w-full">
              <svg className="mr-2 size-5" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  className="opacity-90"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  className="opacity-70"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  className="opacity-50"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  className="opacity-80"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </Button>
          </form>

          <div className="mt-6 space-y-2 border-t border-border pt-5 text-atom-caption text-muted-foreground">
            <p>· GSC keywords, positions, CTR</p>
            <p>· Technical crawl & health score</p>
            <p>· Your data stays on your server</p>
          </div>
        </div>

        <p className="mt-8 text-center text-atom-caption text-muted-foreground">
          Design tokens inspired by{" "}
          <a
            href="https://atomizedesign.com/"
            className="font-medium text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Atomize
          </a>
          {" · "}Open source · MIT
        </p>
      </div>
    </div>
  );
}
