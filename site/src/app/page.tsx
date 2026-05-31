import { Hero } from "@/components/hero";
import { FeatureCard } from "@/components/feature-card";
import { CodeBlock } from "@/components/code-block";
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
    title: "Works with the harness you use",
    description: (
      <>
        Pi today, via{" "}
        <code className="rounded bg-bg/60 px-1 py-0.5 font-mono text-xs text-fg">
          /remote-pi
        </code>
        . The protocol is harness-agnostic — Claude Code and OpenCode join as
        adapters land.
      </>
    ),
    icon: <TerminalIcon />,
  },
  {
    title: "Mesh across machines",
    description:
      "UDS broker on the same machine, relay across PCs. One Owner key, one mesh — no central server.",
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

const quickStartCode = `# 1. Install the Pi extension on your Pi agent host
pi install npm:remote-pi

# 2. Pair your phone:
/remote-pi pair

# 3. Scan the QR code with the Remote Pi app on your phone.

#Done — chat with any agent in your mesh from anywhere.`;

export default function Home() {
  return (
    <>
      <Hero />

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
              Pair your phones, drive the mesh.
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
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
            <div className="flex flex-col gap-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                New · Daemon mode
              </p>
              <h2
                id="daemon-mode-heading"
                className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
              >
                Keep your agents alive 24/7.
              </h2>
              <p className="text-base leading-relaxed text-muted">
                One supervisor per machine turns any paired folder into a
                background agent — survives logout, restarts on crash, answers
                the mesh at 3am. launchd on macOS, systemd on Linux.
              </p>
              <p className="rounded-xl border border-border-soft bg-bg/60 px-4 py-3 text-sm leading-relaxed text-muted">
                <strong className="text-fg">Heads up:</strong> daemons inherit
                your Pi tool permissions — Bash, Edit, Write run without
                prompts. Lock those down before promoting a folder.
              </p>
              <a
                href="/docs#daemon-mode"
                className="inline-flex h-10 w-fit items-center justify-center rounded-full border border-border-soft px-5 text-sm font-medium text-fg transition-colors hover:border-fg/40"
              >
                Read the daemon docs →
              </a>
            </div>
            <ol className="grid gap-3 sm:grid-cols-2">
              <DaemonStep
                n={1}
                title="Pair the folder"
                command="/remote-pi pair"
                description="Run the wizard and scan the QR. Keys and paired devices live in the cwd."
              />
              <DaemonStep
                n={2}
                title="Install the supervisor"
                command="/remote-pi install"
                description="Once per machine — installs the user-level service (launchd/systemd) and links the remote-pi CLI into ~/.local/bin/."
              />
              <DaemonStep
                n={3}
                title="Create the daemon"
                command='remote-pi create ~/Movies --name "Video Editor"'
                description="Registers the folder and starts it right away. Auto-restarts on crash, comes back on reboot."
              />
              <DaemonStep
                n={4}
                title="Manage the fleet"
                command="remote-pi daemons"
                description="List daemons, check status, send prompts, or stop the lot — one CLI."
              />
            </ol>
          </div>
        </div>
      </section>

      <section
        id="quick-start"
        aria-labelledby="quick-start-heading"
        className="border-b border-border-soft"
      >
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Quick start
            </p>
            <h2
              id="quick-start-heading"
              className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
            >
              Three steps from zero to mesh.
            </h2>
            <p className="text-base leading-relaxed text-muted">
              No accounts, no sign-up. Install the extension, scan a QR once,
              and the mesh is alive.
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 w-fit items-center justify-center rounded-full border border-border-soft px-5 text-sm font-medium text-fg transition-colors hover:border-fg/40"
            >
              Read the full guide on GitHub →
            </a>
          </div>
          <CodeBlock code={quickStartCode} label="On your Pi" language="bash" />
        </div>
      </section>

      <section aria-labelledby="cta-heading">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
          <h2
            id="cta-heading"
            className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl"
          >
            Ready to mesh your agents?
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
            Read the docs on GitHub
          </a>
        </div>
      </section>
    </>
  );
}

function DaemonStep({
  n,
  title,
  command,
  description,
}: {
  n: number;
  title: string;
  command: string;
  description: string;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border-soft bg-surface p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
          {n}
        </span>
        <span className="font-semibold text-fg">{title}</span>
      </div>
      <code className="block overflow-x-auto rounded-md bg-bg/70 px-3 py-2 font-mono text-xs leading-relaxed text-fg">
        {command}
      </code>
      <p className="text-xs leading-relaxed text-muted">{description}</p>
    </li>
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
