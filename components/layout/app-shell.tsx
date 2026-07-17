import Link from "next/link";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { SiteSwitcher } from "@/components/sites/site-switcher";
import { SidebarNav } from "@/components/layout/sidebar-nav";

type AppShellProps = {
  email?: string | null;
  children: React.ReactNode;
  sites: { id: string; domain: string }[];
};

export function AppShell({ email, children, sites }: AppShellProps) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="border-b border-sidebar-border bg-sidebar lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col px-3 py-5">
          <Link
            href="/dashboard"
            className="mb-6 flex items-center gap-3 rounded-lg px-2 py-1 transition hover:bg-sidebar-accent"
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[var(--shadow-2)]">
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                aria-hidden
              >
                <path
                  d="M4 18 L12 5 L20 18"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
              </svg>
            </div>
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-foreground">
                CrawlSEO
              </p>
              <p className="text-atom-tiny font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Search ops
              </p>
            </div>
          </Link>

          <SidebarNav sites={sites} />

          <div className="mt-auto space-y-3 border-t border-sidebar-border pt-4">
            {sites.length > 0 && (
              <div className="px-1">
                <SiteSwitcher sites={sites} />
              </div>
            )}

            <div className="rounded-xl border border-border bg-card px-3 py-3 shadow-[var(--shadow-1)]">
              <p className="text-atom-tiny font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Signed in
              </p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">
                {email}
              </p>
              <form
                className="mt-3"
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 bg-background">
        <main className="mx-auto max-w-[1156px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
