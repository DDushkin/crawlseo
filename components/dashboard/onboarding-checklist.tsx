"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Globe,
  Link2,
  RefreshCw,
  Bug,
  Check,
  ChevronRight,
  X,
} from "lucide-react";

type Step = {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  done: boolean;
  href: string;
  actionLabel: string;
};

interface OnboardingChecklistProps {
  hasSites: boolean;
  hasGscConnected: boolean;
  hasSyncedData: boolean;
  hasCrawled: boolean;
  firstSiteId?: string;
}

export function OnboardingChecklist({
  hasSites,
  hasGscConnected,
  hasSyncedData,
  hasCrawled,
  firstSiteId,
}: OnboardingChecklistProps) {
  const [dismissed, setDismissed] = useState(false);

  const allDone = hasSites && hasGscConnected && hasSyncedData && hasCrawled;
  if (allDone || dismissed) return null;

  const steps: Step[] = [
    {
      id: "add-site",
      label: "Add a site",
      description: "Connect a Google Search Console property to monitor",
      icon: <Globe className="size-4" />,
      done: hasSites,
      href: "/sites",
      actionLabel: "Add site",
    },
    {
      id: "connect-gsc",
      label: "Connect GSC",
      description: "Link your Google Search Console for keyword and page data",
      icon: <Link2 className="size-4" />,
      done: hasGscConnected,
      href: firstSiteId ? `/sites/${firstSiteId}` : "/sites",
      actionLabel: "Connect",
    },
    {
      id: "first-sync",
      label: "Sync GSC data",
      description: "Pull the last 28 days of search performance data",
      icon: <RefreshCw className="size-4" />,
      done: hasSyncedData,
      href: firstSiteId ? `/sites/${firstSiteId}` : "/sites",
      actionLabel: "Sync now",
    },
    {
      id: "first-crawl",
      label: "Run first crawl",
      description: "Audit your site for technical SEO issues",
      icon: <Bug className="size-4" />,
      done: hasCrawled,
      href: firstSiteId ? `/sites/${firstSiteId}/crawl` : "/sites",
      actionLabel: "Start crawl",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  return (
    <div className="panel relative mb-6 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />

      <div className="flex items-start justify-between px-5 pt-5">
        <div>
          <h3 className="font-heading text-lg font-semibold text-foreground">
            Get started
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {completedCount}/{steps.length} steps completed
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          title="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="mx-5 mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="divide-y divide-border/40 px-2 pb-2 pt-4">
        {steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              "flex items-center gap-4 rounded-xl px-3 py-3 transition",
              step.done ? "opacity-60" : "hover:bg-muted/30"
            )}
          >
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full",
                step.done
                  ? "bg-signal/15 text-signal"
                  : "bg-primary/10 text-primary"
              )}
            >
              {step.done ? <Check className="size-4" /> : step.icon}
            </div>

            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  step.done
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                )}
              >
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>

            {!step.done && (
              <Link
                href={step.href}
                className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
              >
                {step.actionLabel}
                <ChevronRight className="size-3" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
