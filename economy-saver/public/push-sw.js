// This worker only displays reminders and opens the app's Home page.
function home(value) {
  const url = new URL("/", self.location.origin).href;
  return value === url ? url : null;
}

self.addEventListener("push", event => {
  let payload;
  try { payload = event.data?.json(); }
  catch { return; }
  const url = home(payload?.url);
  if (!url || typeof payload.title !== "string" || typeof payload.body !== "string") return;
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, data: url }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = home(event.notification.data);
  if (!url) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url === url);
    return existing ? existing.focus() : self.clients.openWindow(url);
  })());
});
