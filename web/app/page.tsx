import { PiApp } from "@/components/pi/PiApp";

/**
 * The page is a prerendered shell around a browser-only client.
 *
 * WebCrypto, WebSocket and IndexedDB do not exist on the server, so the server
 * component renders nothing interactive — `PiApp` boots the session on
 * hydration. Keeping this a server component means the shell is still
 * prerendered and instantly paint-able offline.
 */
export default function Home() {
  return <PiApp />;
}
