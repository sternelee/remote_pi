import type { Metadata } from "next";
import Link from "next/link";
import { FeatureCard } from "@/components/feature-card";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "Why Pi",
  description:
    "Deciding how to run an always-on coding agent? remote-pi keeps Pi alive 24/7 and puts it in your pocket. Here's when that's the right shape — and when an all-in-one platform isn't.",
};

const GITHUB_URL = "https://github.com/jacobaraujo7/remote_pi";

const highlights = [
  {
    title: "Alive 24/7",
    description:
      "A per-machine supervisor (launchd on macOS, systemd on Linux) keeps every paired folder running as a background agent — survives logout, restarts on crash, answers at 3am.",
  },
  {
    title: "Lightweight",
    description:
      "Pi is a small coding agent, not a platform. It boots fast and runs only what you add to it — nothing you didn't ask for.",
  },
  {
    title: "You assemble it",
    description:
      "Extend Pi with the skills, plugins, and per-folder agents you actually need. The agent is yours to shape until it fits your work exactly.",
  },
  {
    title: "Driven from your phone",
    description:
      "Pair once with a QR. Send prompts, switch models, start a fresh session, or compact context from iOS or Android — wherever you are.",
  },
  {
    title: "A mesh when you need it",
    description:
      "Agents reach each other on one machine over a local socket, or across PCs through the relay. One Owner key, one mesh, no central server.",
  },
  {
    title: "Open source, self-hostable",
    description:
      "MIT licensed. Run the community relay or host your own; traffic is encrypted in transit, and self-hosting keeps it on infrastructure you control.",
  },
];

export default function WhyPage() {
  return (
    <>
      <section className="border-b border-border-soft">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-20 sm:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Why Pi
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
            An always-on agent you assemble yourself.
          </h1>
          <p className="text-pretty text-lg leading-relaxed text-muted">
            remote-pi turns Pi into a background agent that never logs off — and
            a phone in your pocket that drives it. This page is about that
            choice: keeping a coding agent alive 24/7, and whether building it up
            from something small is the shape you want.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="pi-highlights-heading"
        className="border-b border-border-soft"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12 flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              What you get
            </p>
            <h2
              id="pi-highlights-heading"
              className="max-w-2xl text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
            >
              Pi, kept alive and put in your pocket.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((item) => (
              <FeatureCard
                key={item.title}
                title={item.title}
                description={item.description}
              />
            ))}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="comparison-heading"
        className="border-b border-border-soft bg-surface/40"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            The honest version
          </p>
          <h2
            id="comparison-heading"
            className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
          >
            What about OpenClaw and Hermes Agent?
          </h2>
          <p className="text-base leading-relaxed text-muted">
            They&apos;re excellent. <strong className="text-fg">OpenClaw</strong>{" "}
            and <strong className="text-fg">Hermes Agent</strong> are first-class
            always-on, open-source agents. If you want a batteries-included
            platform that ships ready to run, you should look hard at them —
            this page won&apos;t pretend otherwise.
          </p>
          <p className="text-base leading-relaxed text-muted">
            remote-pi makes a different bet. It starts from Pi — a lightweight
            coding agent — and adds just the always-on layer: a supervisor that
            keeps it running and a phone that drives it. Everything else, you
            assemble. The trade is real: less out of the box, more that&apos;s
            exactly yours.
          </p>

          <Callout variant="note" title="The choice">
            Want a complete, all-in-one platform, ready out of the box? OpenClaw
            and Hermes Agent are great places to start. Want a lightweight coding
            agent you assemble, keep alive 24/7, and control from your phone?
            That&apos;s Pi with remote-pi.
          </Callout>

          <p className="text-sm leading-relaxed text-muted">
            One note on scope: this comparison is about the{" "}
            <em className="text-fg">always-on layer</em> — remote-pi&apos;s
            daemon mode — not coding agents in general. It&apos;s the part where
            keeping an agent alive and reachable is the whole job, and where
            OpenClaw and Hermes Agent shine too.
          </p>
        </div>
      </section>

      <section aria-labelledby="why-cta-heading">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
          <h2
            id="why-cta-heading"
            className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
          >
            Build yours and leave it running.
          </h2>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted">
            Add the plugin to Pi, pair your phone, and promote a folder to a
            24/7 daemon. The how-to walks every step.
          </p>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link
              href="/#install"
              className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              Install
            </Link>
            <Link
              href="/tutorials/daemon"
              className="inline-flex h-11 items-center justify-center rounded-full border border-border-soft px-6 text-sm font-semibold text-fg transition-colors hover:border-fg/40"
            >
              Daemon how-to →
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-full border border-border-soft px-6 text-sm font-semibold text-fg transition-colors hover:border-fg/40"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
