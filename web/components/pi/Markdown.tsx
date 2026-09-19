"use client";

import { memo } from "react";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import { useResolvedTheme } from "@/lib/theme";

/**
 * Agent markdown, rendered with Streamdown.
 *
 * Streamdown is a drop-in react-markdown replacement built for streaming
 * output: `parseIncompleteMarkdown` (remend) repairs half-written fences and
 * emphasis as deltas arrive, so partial markdown renders cleanly mid-turn
 * instead of flashing raw syntax. Its default `rehype-sanitize` pipeline keeps
 * model output from injecting markup.
 *
 * Styling is deliberately kept in `app/globals.css` under `.pi-markdown` rather
 * than via `components` overrides: overriding `a` would bypass Streamdown's
 * built-in `linkSafety` confirmation modal, which we want on model-authored
 * URLs. Shiki highlights with the tokyo-night theme; copy-only per code block
 * (the Flutter app offers copy with no syntax chrome beyond highlighting).
 */
export const Markdown = memo(function Markdown({
  children,
  streaming,
}: {
  children: string;
  streaming?: boolean;
}) {
  // Shiki ships both themes; the resolved theme selects which one highlights so
  // code stays legible on either surface. tokyo-night on light would be a
  // wash.
  const theme = useResolvedTheme();
  const shikiTheme = theme === "light" ? "github-light" : "tokyo-night";
  return (
    <div className="pi-markdown min-w-0">
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        // While a turn streams, keep the copy button inert: the block is not
        // final, so copying it is a trap.
        isAnimating={!!streaming}
        plugins={{ code }}
        shikiTheme={[shikiTheme, shikiTheme]}
        controls={{
          code: { copy: true, download: false },
          table: false,
          mermaid: false,
          image: false,
        }}
        lineNumbers={false}
      >
        {children}
      </Streamdown>
    </div>
  );
});
