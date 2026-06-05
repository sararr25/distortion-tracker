self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function resolveTargetUrl(targetUrl) {
  try {
    return new URL(targetUrl || "/", self.location.origin).href;
  } catch {
    return new URL("/", self.location.origin).href;
  }
}

function focusOrOpenTarget(targetUrl) {
  const resolvedUrl = resolveTargetUrl(targetUrl);

  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ("navigate" in client) {
        return client.navigate(resolvedUrl).then((navigatedClient) => {
          if (navigatedClient && "focus" in navigatedClient) {
            return navigatedClient.focus();
          }
          if ("focus" in client) {
            return client.focus();
          }
          return undefined;
        });
      }

      if ("focus" in client) {
        return client.focus();
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(resolvedUrl);
    }
    return undefined;
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(focusOrOpenTarget(targetUrl));
});
