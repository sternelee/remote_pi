import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Tutorials",
  description:
    "Hands-on guides for Remote Pi: get started with the app, run a local mesh, route across PCs, and keep an agent alive 24/7.",
};

const tutorials = [
  {
    href: "/tutorials/getting-started",
    step: "1",
    title: "Getting started",
    blurb:
      "Install Remote Pi, pair your phone, and drive your first agent from the app.",
  },
  {
    href: "/tutorials/mesh-local",
    step: "2",
    title: "Local mesh",
    blurb:
      "Let two agents on the same machine discover each other and trade messages.",
  },
  {
    href: "/tutorials/mesh-remote",
    step: "3",
    title: "Remote mesh",
    blurb:
      "Route messages between agents on different PCs through the relay.",
  },
  {
    href: "/tutorials/daemon",
    step: "4",
    title: "Daemon mode",
    blurb:
      "Keep an agent alive 24/7 with the supervisor, then manage the fleet.",
  },
];

const extras = [
  {
    href: "/tutorials/claude-mesh",
    title: "Claude in the mesh",
    blurb:
      "Put Claude Code on the agent mesh next to Pi — advanced, terminal-only (not in the app yet).",
  },
];

export default function TutorialsIndexPage() {
  return (
    <section className="border-b border-border-soft">
      <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-20">
        <header className="mb-12 flex flex-col gap-3 border-b border-border-soft pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Tutorials
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
            Learn Remote Pi by doing.
          </h1>
          <p className="text-base leading-relaxed text-muted">
            Four hands-on guides, in order. Start with the app, then add agents,
            cross-PC routing, and a 24/7 supervisor as you need them. For the{" "}
            <em className="text-fg">why</em> behind it,{" "}
            <Link href="/why" className="text-accent underline">
              read Why Pi
            </Link>
            ; for exact flags and config, the{" "}
            <Link href="/docs" className="text-accent underline">
              reference docs
            </Link>
            .
          </p>
        </header>

        <ol className="flex flex-col gap-4">
          {tutorials.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                className="group flex items-start gap-4 rounded-2xl border border-border-soft bg-surface p-5 transition-colors hover:border-fg/30 sm:p-6"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
                  {t.step}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tracking-tight text-fg">
                    {t.title}
                  </span>
                  <span className="text-sm leading-relaxed text-muted">
                    {t.blurb}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <div className="mt-12 flex flex-col gap-4 border-t border-border-soft pt-10">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
            Extras
          </h2>
          <ul className="flex flex-col gap-4">
            {extras.map((t) => (
              <li key={t.href}>
                <Link
                  href={t.href}
                  className="group flex items-start gap-4 rounded-2xl border border-border-soft bg-surface p-5 transition-colors hover:border-fg/30 sm:p-6"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
                    ★
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-lg font-semibold tracking-tight text-fg">
                      {t.title}
                    </span>
                    <span className="text-sm leading-relaxed text-muted">
                      {t.blurb}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
