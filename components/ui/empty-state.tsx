import Link from "next/link";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  icon = "◎",
  className,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  icon?: string;
  className?: string;
}) {
  return (
    <div className={cn("panel px-6 py-14 text-center", className)}>
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-accent text-lg text-primary shadow-[var(--shadow-1)]">
        {icon}
      </div>
      <h3 className="font-heading text-atom-subheader font-semibold text-foreground">
        {title}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-atom-body text-muted-foreground">
        {description}
      </p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-6 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[var(--shadow-1)] transition hover:bg-[var(--a-info-800)]"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
