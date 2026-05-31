import Link from "next/link";

type PagerLink = {
  href: string;
  label: string;
};

type PagerProps = {
  prev?: PagerLink;
  next?: PagerLink;
};

/**
 * Previous / next navigation for the tutorials section (Wave C). Either side is
 * optional; a missing side keeps the present one pinned to its edge.
 */
export function Pager({ prev, next }: PagerProps) {
  return (
    <nav
      aria-label="Tutorial navigation"
      className="mt-12 flex items-stretch justify-between gap-4 border-t border-border-soft pt-6"
    >
      {prev ? (
        <Link
          href={prev.href}
          className="group flex max-w-[45%] flex-col gap-1 rounded-xl border border-border-soft bg-surface px-4 py-3 transition-colors hover:border-fg/30"
        >
          <span className="text-xs uppercase tracking-wider text-muted">
            ← Previous
          </span>
          <span className="text-sm font-medium text-fg">{prev.label}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group flex max-w-[45%] flex-col items-end gap-1 rounded-xl border border-border-soft bg-surface px-4 py-3 text-right transition-colors hover:border-fg/30"
        >
          <span className="text-xs uppercase tracking-wider text-muted">
            Next →
          </span>
          <span className="text-sm font-medium text-fg">{next.label}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
