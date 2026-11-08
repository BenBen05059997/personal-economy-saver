"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ApiForm, ApiFormGroup } from "@/components/ui/ApiForm";
import type { reminderView } from "@/db/reminders";
import { FORM_FETCH_HEADER } from "@/lib/form-fetch";

type ReminderView = Awaited<ReturnType<typeof reminderView>>;
type Subscription = { value: PushSubscription; hash: string };
type Device =
  | { status: "checking" | "unsupported" | "failed" }
  | { status: "ready"; subscription: Subscription | null };

const ROUTE = "/api/reminders";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: String(hour).padStart(2, "0") + ":00",
}));

async function identify(value: PushSubscription | null): Promise<Subscription | null> {
  if (!value) return null;
  const bytes = new TextEncoder().encode(value.endpoint);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return { value, hash };
}

function applicationServerKey(encoded: string) {
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), byte => byte.charCodeAt(0)).buffer;
}

async function inspectDevice(): Promise<Device> {
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { status: "unsupported" };
  }
  const worker = await navigator.serviceWorker.getRegistration("/");
  const subscription = await worker?.pushManager.getSubscription();
  return { status: "ready", subscription: await identify(subscription ?? null) };
}

async function postPush(fields: Record<string, string>) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  let response: Response;
  try {
    response = await fetch(ROUTE, { method: "POST", body, headers: { [FORM_FETCH_HEADER]: "1" } });
  } catch {
    throw new Error("Couldn’t reach the app. Check your connection and try again.");
  }
  const message = await response.text();
  if (!response.ok) throw new Error(message || "The app couldn’t update push. Try again.");
  return message;
}

function PushOnDevice({ pushPublicKey, pushProblem, endpointHashes }: Pick<ReminderView, "pushPublicKey" | "pushProblem" | "endpointHashes">) {
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  const [device, setDevice] = useState<Device>({ status: "checking" });
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const local = device.status === "ready" ? device.subscription : null;
  const enabled = local !== null && endpointHashes.includes(local.hash);
  const busy = refreshing || working;

  useEffect(() => {
    let mounted = true;
    void inspectDevice().then(
      result => { if (mounted) setDevice(result); },
      () => { if (mounted) setDevice({ status: "failed" }); },
    );
    return () => { mounted = false; };
  }, []);

  async function change(action: "subscribe" | "unsubscribe" | "test") {
    if (busy) return;
    setWorking(true);
    setStatus("");
    try {
      if (action === "subscribe") {
        if (!pushPublicKey) return;
        // Request permission from this button's click, before waiting for the worker.
        if (await Notification.requestPermission() !== "granted") {
          setStatus("Allow notifications in your browser settings, then try again.");
          return;
        }
        const worker = await navigator.serviceWorker.register("/push-sw.js", { scope: "/", updateViaCache: "none" });
        const registration = worker.active ? worker : await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: applicationServerKey(pushPublicKey),
        });
        const enrolled = subscription.toJSON();
        if (!enrolled.keys?.p256dh || !enrolled.keys.auth) throw new Error("This browser could not create a push subscription.");
        setDevice({ status: "ready", subscription: await identify(subscription) });
        setStatus(await postPush({ kind: action, endpoint: subscription.endpoint, p256dh: enrolled.keys.p256dh, auth: enrolled.keys.auth }));
      } else {
        if (!local || !enabled) return;
        const endpoint = local.value.endpoint;
        if (action === "test") {
          setStatus(await postPush({ kind: "test", channel: "push", endpoint }));
        } else {
          const message = await postPush({ kind: action, endpoint });
          try {
            await local.value.unsubscribe();
            setDevice({ status: "ready", subscription: null });
          } catch {
            setStatus("Push is off for this device. The browser could not remove its local subscription.");
            return;
          }
          setStatus(message);
        }
      }
    } catch (error) {
      const message = error instanceof Error && !(error instanceof DOMException) ? error.message : "This browser could not update push. Try again.";
      setStatus(message);
    } finally {
      setWorking(false);
      refresh(() => router.refresh());
    }
  }

  return <div className="settings-push" aria-busy={busy}>
    <h3>Push on this device</h3>
    <p className="ui-hint">{pushProblem ? "Off. " + pushProblem : device.status === "checking" ? "Checking this device…" : enabled ? "On for this device." : "Off for this device."}</p>
    {device.status === "unsupported" && <p className="ui-hint">Push needs a browser and app address that support notifications.</p>}
    {device.status === "failed" && <p className="ui-hint">Couldn’t check this device. Reload Settings to try again.</p>}
    <div className="settings-reminder-actions">
      <button type="button" className="ui-button" disabled={busy || (!enabled && (device.status !== "ready" || !pushPublicKey))}
        onClick={() => void change(enabled ? "unsubscribe" : "subscribe")}>{enabled ? "Turn off push" : "Turn on push"}</button>
      {enabled && <button type="button" className="ui-button" disabled={busy || !pushPublicKey} onClick={() => void change("test")}>Send a test push</button>}
    </div>
    <p className="ui-hint ui-form-status" role="status">{status}</p>
  </div>;
}

export function Reminders({ view, timeZone }: { view: ReminderView; timeZone: string }) {
  return <section className="ui-panel" id="reminders" aria-labelledby="reminders-title">
    <h2 id="reminders-title">Reminders</h2>
    <p className="ui-hint">Get a daily note when your assistant finds something new. Choose how it reaches you.</p>
    <ApiFormGroup>
      <ApiForm action={ROUTE}>
        <input type="hidden" name="kind" value="settings" />
        <label className="settings-check">
          <input type="checkbox" name="emailOn" value="on" key={String(view.emailOn) + String(view.emailAvailable)}
            defaultChecked={view.emailAvailable && view.emailOn} disabled={!view.emailAvailable} aria-describedby="reminder-email-hint" />
          Email reminders
        </label>
        <p className="ui-hint" id="reminder-email-hint">{view.emailProblem ? "Off. " + view.emailProblem : "Sent to your sign-in email."}</p>
        <label className="ui-field">Reminder hour ({timeZone})
          <select name="hour" key={view.hour} defaultValue={view.hour}>{HOURS.map(hour => <option key={hour.value} value={hour.value}>{hour.label}</option>)}</select>
        </label>
        <fieldset className="settings-quiet-days" key={view.quietDays.join(",")}>
          <legend>Quiet days</legend>
          <div>{DAYS.map((day, number) => <label className="settings-check" key={day}>
            <input type="checkbox" name="quietDays" value={number} defaultChecked={view.quietDays.includes(number)} />{day}
          </label>)}</div>
        </fieldset>
        <button className="ui-button">Save reminder settings</button>
      </ApiForm>
      {view.emailAvailable && <ApiForm action={ROUTE}>
        <input type="hidden" name="kind" value="test" /><input type="hidden" name="channel" value="email" />
        <button className="ui-button">Send a test email</button>
      </ApiForm>}
    </ApiFormGroup>
    <PushOnDevice pushPublicKey={view.pushPublicKey} pushProblem={view.pushProblem} endpointHashes={view.endpointHashes} />
  </section>;
}
