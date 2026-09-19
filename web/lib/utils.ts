/**
 * shadcn `cn` — the brainless components in `components/brainless/**` import this.
 *
 * Backed by the `cn` package (https://github.com/shadcn-ui/cn), a drop-in
 * replacement for `clsx` + `tailwind-merge` that is faster and dependency-free.
 * Re-exported rather than reimplemented so every `@/lib/utils` consumer and the
 * vendored registry components keep importing the shadcn alias unchanged.
 */
export { cn, type ClassValue } from "cn";
