import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/pi/Markdown";

function render(text: string, streaming = false): string {
  return renderToStaticMarkup(<Markdown streaming={streaming}>{text}</Markdown>);
}

describe("Markdown", () => {
  it("renders markdown as markup rather than literal text", () => {
    const html = render("# Title\n\nhello **world**");
    expect(html).toContain("Title");
    expect(html).toContain("world");
    expect(html).toContain('data-streamdown="strong"');
  });

  it("neutralizes raw HTML instead of injecting it", () => {
    const html = render('<img src=x onerror=alert(1)>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("renders a fenced code block with a copy control", () => {
    const html = render("```ts\nconst a = 1;\n```");
    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain("const a = 1;");
    expect(html).toContain('data-streamdown="code-block-copy-button"');
  });

  it("keeps the copy control inert while streaming", () => {
    const streaming = render("```ts\nconst a = 1;\n```", true);
    expect(streaming).toContain('data-streamdown="code-block"');
    expect(streaming).toContain("disabled");
  });

  it("routes links through the link-safety confirm button", () => {
    const html = render("see [the docs](https://example.com/docs)");
    expect(html).toContain('data-streamdown="link"');
    expect(html).toContain("the docs");
  });
});
