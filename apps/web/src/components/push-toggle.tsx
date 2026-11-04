"use client";

import { useEffect, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";

type Status = "checking" | "unsupported" | "unavailable" | "off" | "on" | "denied";

function toKey(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

/**
 * "Tell this phone": one switch that registers the service worker, asks the browser for permission and files
 * the subscription with the API. The state shown is the browser's real state, read on mount, never remembered.
 */
export function PushToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    browserApi
      .get<{ enabled: boolean; publicKey: string | null }>("/me/push")
      .then(async (r) => {
        if (!r.enabled || !r.publicKey) return setStatus("unavailable");
        setPublicKey(r.publicKey);
        if (Notification.permission === "denied") return setStatus("denied");
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        setStatus(sub ? "on" : "off");
      })
      .catch(() => setStatus("unavailable"));
  }, []);

  async function turnOn() {
    if (!publicKey) return;
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) as BufferSource }));
      const json = sub.toJSON();
      await browserApi.post("/me/push/subscriptions", { endpoint: json.endpoint, keys: json.keys });
      setStatus("on");
      setNote("On. Try it: send a test.");
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Could not turn notifications on in this browser.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await browserApi.del("/me/push/subscriptions", { endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setNote(null);
    try {
      const r = await browserApi.post<{ sent: number }>("/me/push/test");
      setNote(r.sent > 0 ? "Sent. It should appear in a moment." : "Nothing subscribed.");
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "The test could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking" || status === "unsupported") return null;
  return (
    <div className="card-inset nb-left-blue mb-5 flex flex-wrap items-center justify-between gap-3 text-sm" data-push-status={status}>
      <div className="min-w-0">
        <p className="font-medium">Tell this device when a decision is waiting</p>
        <p className="text-xs text-muted">
          {status === "unavailable" && "Notifications are not set up on this deployment."}
          {status === "denied" && "This browser has blocked notifications for Steward. Allow them in the browser's site settings, then reload."}
          {status === "off" && "A notification on this device for every new approval, in any of your companies."}
          {status === "on" && "On for this device."}
        </p>
        {note && <p className="mt-1 text-xs" role="status">{note}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {status === "off" && <button type="button" className="btn btn-primary" disabled={busy} onClick={turnOn}>Turn on</button>}
        {status === "on" && (
          <>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={sendTest}>Send a test</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={turnOff}>Turn off</button>
          </>
        )}
      </div>
    </div>
  );
}
