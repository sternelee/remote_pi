import Link from "next/link";
import { Hero } from "@/components/hero";
import { FeatureCard } from "@/components/feature-card";
import { InstallTabs } from "@/components/install-tabs";
import { DownloadButtons } from "@/components/download-buttons";

const GITHUB_URL = "https://github.com/jacobaraujo7/remote_pi";

const features = [
  {
    title: "Phone is just the authenticator",
    description:
      "Scan a QR once to add a machine. The PCs run on their own after that; extra phones share one Owner key and stay in sync.",
    icon: <ShieldIcon />,
  },
  {
    title: "A plugin for Pi",
    description: (
      <>
        Drop it into Pi with{" "}
        <code className="rounded bg-bg/60 px-1 py-0.5 font-mono text-xs text-fg">
          /remote-pi
        </code>{" "}
        — no new app to learn. The wire protocol is harness-agnostic, so Claude
        Code and OpenCode can join as adapters land.
      </>
    ),
    icon: <TerminalIcon />,
  },
  {
    title: "Scales to many machines",
    description:
      "When you outgrow one box, agents reach each other across PCs through the relay — one Owner key, one mesh, no central server.",
    icon: <MeshIcon />,
  },
  {
    title: "Talk instead of type",
    description:
      "Dictate prompts with on-device speech-to-text. No cloud transcription step.",
    icon: <VoiceIcon />,
  },
  {
    title: "Attach an image",
    description:
      "Send a photo or screenshot straight to a multimodal agent.",
    icon: <ImageIcon />,
  },
  {
    title: "Open source, self-hostable",
    description:
      "MIT licensed. Self-host the relay behind a VPN for full confidentiality from the operator.",
    icon: <SparkIcon />,
  },
];

export default function Home() {
  return (
    <>
      <Hero />

      <section
        id="install"
        aria-labelledby="install-heading"
        className="border-b border-border-soft"
      >
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Install
            </p>
            <h2
              id="install-heading"
              className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
            >
              One command, then scan a QR.
            </h2>
            <p className="text-base leading-relaxed text-muted">
              No accounts, no sign-up. Add the plugin to Pi, pair your phone
              once, and you&apos;re driving every agent from your pocket.
            </p>
          </div>
          <InstallTabs />
        </div>
      </section>

      <section
        id="get-the-app"
        aria-labelledby="get-the-app-heading"
        className="border-b border-border-soft"
      >
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-6 py-16 text-center sm:py-20">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Get the app
            </p>
            <h2
              id="get-the-app-heading"
              className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
            >
              Pair your phone, drive your agents.
            </h2>
            <p className="mx-auto max-w-xl text-pretty text-base leading-relaxed text-muted">
              The authenticator and the remote control. On the App Store,
              Google Play, or as an Android APK on GitHub.
            </p>
          </div>
          <DownloadButtons />
        </div>
      </section>

      <section
        aria-labelledby="features-heading"
        className="border-b border-border-soft"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12 flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Why Remote Pi
            </p>
            <h2
              id="features-heading"
              className="max-w-2xl text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
            >
              Built for running coding agents on more than one box.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <FeatureCard
                key={feature.title}
                title={feature.title}
                description={feature.description}
                icon={feature.icon}
              />
            ))}
          </div>
        </div>
      </section>

      <section
        id="daemon-mode"
        aria-labelledby="daemon-mode-heading"
        className="border-b border-border-soft bg-surface/40"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex flex-col gap-6 rounded-3xl border border-border-soft bg-bg/40 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
            <div className="flex max-w-xl flex-col gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Daemon mode
              </p>
              <h2
                id="daemon-mode-heading"
                className="text-balance text-2xl font-semibold tracking-tight text-fg sm:text-3xl"
              >
                Keep your agents alive 24/7.
              </h2>
              <p className="text-base leading-relaxed text-muted">
                One supervisor per machine turns any paired folder into a
                background agent — survives logout, restarts on crash, answers
                from your phone at 3am.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:items-end">
              <Link
                href="/why"
                className="inline-flex h-10 w-fit items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Why run agents 24/7 →
              </Link>
              <Link
                href="/tutorials/daemon"
                className="inline-flex h-10 w-fit items-center justify-center rounded-full border border-border-soft px-5 text-sm font-medium text-fg transition-colors hover:border-fg/40"
              >
                Daemon how-to →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-heading">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
          <h2
            id="cta-heading"
            className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
          >
            Open source, all the way down.
          </h2>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted">
            Active MVP. Read the source, run the protocol, or self-host the
            relay — it&apos;s all on GitHub.
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            View on GitHub
          </a>
        </div>
      </section>
    </>
  );
}

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  );
}

function MeshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M7.6 7.5 11 16.4M16.4 7.5 13 16.4M8 6h8" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 16-5-5L5 20" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  );
}
