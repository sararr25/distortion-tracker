importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

let messaging = null;

async function initMessaging() {
  if (messaging) return messaging;

  const response = await fetch("/api/firebase-init", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch firebase init config for service worker");
  }

  const config = await response.json();
  if (!firebase.apps.length) {
    firebase.initializeApp(config);
  }

  messaging = firebase.messaging();
  return messaging;
}

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

void initMessaging()
  .then((messagingClient) => {
    messagingClient.onBackgroundMessage((payload) => {
      const data = payload.data || {};
      const title = data.type === "meet"
        ? `Meet request from ${data.fromName || "Someone"} ${data.fromEmoji || "📍"}`
        : "Distortion Tracker";
      const options = {
        body: data.type === "meet" ? "Tap to open the Distortion map" : payload.notification?.body || "Tap to open the app",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        vibrate: [200, 100, 200, 100, 400],
        requireInteraction: true,
        data: {
          type: data.type || "meet",
          requestId: data.requestId,
          fromUid: data.fromUid,
          fromName: data.fromName,
          fromEmoji: data.fromEmoji,
          lat: data.lat,
          lng: data.lng,
          url: data.url || (data.requestId ? `/?meetRequestId=${encodeURIComponent(data.requestId)}` : "/"),
        },
      };

      self.registration.showNotification(title, options);
    });
  })
  .catch((error) => {
    console.warn("Messaging service worker initialization failed", error);
  });
