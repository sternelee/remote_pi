import type { ReactNode } from "react";

type CalloutVariant = "note" | "warning" | "tip";

const VARIANTS: Record<CalloutVariant, { border: string; label: string }> = {
  note: { border: "border-border-soft", label: "text-fg" },
  warning: { border: "border-accent/40", label: "text-accent" },
  tip: { border: "border-border-soft", label: "text-accent" },
};

type CalloutProps = {
  variant?: CalloutVariant;
  /** Lead-in shown in bold before the body, e.g. "Heads up". */
  title?: string;
  children: ReactNode;
};

/**
 * Inline heads-up box. Shared across the home (daemon caveat), the docs, and
 * the tutorials. Presentational only — no state, safe as a server component.
 */
export function Callout({ variant = "note", title, children }: CalloutProps) {
  const styles = VARIANTS[variant];
  return (
    <div
      className={`rounded-xl border ${styles.border} bg-bg/60 px-4 py-3 text-sm leading-relaxed text-muted`}
    >
      {title ? (
        <strong className={`${styles.label} font-semibold`}>{title}:</strong>
      ) : null}{" "}
      {children}
    </div>
  );
}
