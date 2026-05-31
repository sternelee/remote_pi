"use client";

import { Tabs } from "./tabs";
import { CodeBlock } from "./code-block";

const CURL_ONE_LINER =
  "curl -fsSL https://remote-pi.jacobmoura.work/install.sh | bash";

const HAVE_PI_COMMANDS = `pi install npm:remote-pi
/remote-pi
/remote-pi pair`;

type InstallTabsProps = {
  /**
   * Flips the "No Pi yet" curl tab from a disabled "Coming soon" teaser to a
   * live, selectable tab. Stays false until the Wave 0 installer ships and the
   * Wave E route serves install.sh under the canonical domain.
   */
  curlReady?: boolean;
};

/**
 * Two-tab install block shared by the home (Wave A) and the Getting Started
 * tutorial (Wave C). "Already have Pi" is always available; "No Pi yet" waits
 * on the curl installer.
 */
export function InstallTabs({ curlReady = false }: InstallTabsProps) {
  return (
    <Tabs
      ariaLabel="Install Remote Pi"
      items={[
        {
          id: "no-pi",
          label: "No Pi yet",
          disabled: !curlReady,
          badge: curlReady ? undefined : "Coming soon",
          content: (
            <div className="flex flex-col gap-3">
              <CodeBlock code={CURL_ONE_LINER} label="One command" language="bash" />
              <p className="text-sm leading-relaxed text-muted">
                Installs Pi, the Remote Pi plugin, and the always-on supervisor,
                then prints the pairing step. No sudo — everything lands in your
                home directory.
              </p>
            </div>
          ),
        },
        {
          id: "have-pi",
          label: "Already have Pi",
          content: (
            <div className="flex flex-col gap-3">
              <CodeBlock
                code={HAVE_PI_COMMANDS}
                label="Add the plugin"
                language="bash"
              />
              <p className="text-sm leading-relaxed text-muted">
                Run the first line in your shell; the{" "}
                <code className="rounded bg-bg/60 px-1 py-0.5 font-mono text-xs text-fg">
                  /remote-pi
                </code>{" "}
                lines run inside Pi. The first{" "}
                <code className="rounded bg-bg/60 px-1 py-0.5 font-mono text-xs text-fg">
                  /remote-pi
                </code>{" "}
                run is a quick setup wizard (name + relay);{" "}
                <strong className="text-fg">pair</strong> then shows a QR you
                scan with the app.
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}
