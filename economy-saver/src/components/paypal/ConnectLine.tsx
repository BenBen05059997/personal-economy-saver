import Link from "next/link";
import type { ConnectionView } from "@/lib/paypal/contracts";

/** The words for a connection that is not finished. Home and Settings → PayPal both take them from here. */
export function connectWords(connection: ConnectionView): { head: string | null; body: string } | null {
  if (connection.state === "none") return { head: null, body: "Connect your PayPal so fipa can read your balance and make payment links." };
  if (connection.state === "pending") return { head: "Waiting for PayPal.", body: connection.detail ?? "PayPal hasn't finished your sign-up yet. Check again in a moment." };
  return null;
}

export const OWNER_ONLY_CONNECT = "Only the household owner can connect PayPal.";

/** The one line that asks for a PayPal connection. Try it and connected households see nothing. */
export function ConnectLine({ connection, isOwner }: { connection: ConnectionView; isOwner: boolean }) {
  const words = connectWords(connection);
  if (!words) return null;
  return <p className="home-demo" id="connect-paypal">
    {words.head && <>{words.head} </>}{words.body}{" "}
    {isOwner ? <Link prefetch={false} href="/settings/paypal">Connect PayPal ›</Link> : OWNER_ONLY_CONNECT}
  </p>;
}
