"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SiteSwitcher } from "@/components/sites/site-switcher";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  LogOut,
} from "lucide-react";

type AppShellProps = {
  email?: string | null;
  name?: string | null;
  image?: string | null;
  children: React.ReactNode;
  sites: { id: string; domain: string }[];
};

export function AppShell({
  email,
  name,
  image,
  children,
  sites,
}: AppShellProps) {
  const displayName = name || email?.split("@")[0] || "User";
  const initial = displayName.charAt(0).toUpperCase();
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("crawlseo-sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("crawlseo-sidebar-collapsed", String(next));
  }

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo / brand */}
      <div className={cn("flex items-center gap-2.5 px-4 py-5", collapsed && "justify-center px-2")}>
        <Link
          href="/dashboard"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
            <path
              d="M4 18 L12 5 L20 18"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
          </svg>
        </Link>
        {!collapsed && (
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              CrawlSEO
            </p>
            <p className="text-[11px] text-muted-foreground">Search operations</p>
          </div>
        )}
      </div>

      {/* Site switcher */}
      {sites.length > 0 && !collapsed && (
        <div className="px-3 pb-4">
          <SiteSwitcher sites={sites} />
        </div>
      )}

      {/* Navigation */}
      <SidebarNav sites={sites} collapsed={collapsed} />

      {/* Bottom section */}
      <div className="mt-auto space-y-3 px-3 pb-4 pt-4">
        {/* Collapse toggle (desktop only) */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground md:flex"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <>
              <PanelLeftClose className="size-4" />
              <span>Collapse</span>
            </>
          )}
        </button>

        {/* User card */}
        {!collapsed && (
          <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="mb-3 flex items-center gap-2.5">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt=""
                  className="size-9 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-400 text-sm font-semibold text-primary-foreground">
                  {initial}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {displayName}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {email}
                </p>
              </div>
            </div>

            <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
              <span className="text-[11px] text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>

            <a
              href="/api/auth/signout"
              className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-secondary/60 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary"
            >
              <LogOut className="size-3.5" />
              Logout
            </a>
          </div>
        )}

        {/* Collapsed: just avatar + theme */}
        {collapsed && (
          <div className="flex flex-col items-center gap-2">
            <ThemeToggle />
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                className="size-8 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-400 text-xs font-semibold text-primary-foreground">
                {initial}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden h-screen sticky top-0 z-20 shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:block",
          collapsed ? "w-16" : "w-[260px]"
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-end px-4 pt-4">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <span className="text-xs font-bold">C</span>
            </div>
            <span className="font-semibold">CrawlSEO</span>
          </div>
          <ThemeToggle />
        </header>

        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
