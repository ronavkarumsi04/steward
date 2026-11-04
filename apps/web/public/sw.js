/* Steward service worker: shows approval notifications and opens the inbox when one is tapped. No caching:
   the app is always read live, so a stale shell can never show a decided approval as pending. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "Steward", body: "Something is waiting on you.", url: "/app/inbox", tag: undefined };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: "/icon1",
      badge: "/icon1",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app/inbox";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => "focus" in c);
      if (open) return open.navigate(url).then((c) => (c || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
