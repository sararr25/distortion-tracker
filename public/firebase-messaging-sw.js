importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

let messaging = null;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

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

function getNotificationData(notification) {
  const rawData = notification?.data || {};
  const fcmData = rawData.FCM_MSG?.data || {};
  return { ...fcmData, ...rawData };
}

function getNotificationTargetUrl(data) {
  if (data?.url) return data.url;
  if (data?.requestId) return `/?meetRequestId=${encodeURIComponent(data.requestId)}`;
  return "/";
}

function postMeetRequestToClient(client, data) {
  if (!client || !data?.requestId) return;
  client.postMessage({
    type: "open-meet-request",
    requestId: data.requestId,
  });
}

function focusOrOpenTarget(targetUrl, data) {
  const resolvedUrl = resolveTargetUrl(targetUrl);

  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ("navigate" in client) {
        return client.navigate(resolvedUrl).then((navigatedClient) => {
          const targetClient = navigatedClient || client;
          postMeetRequestToClient(targetClient, data);
          if (targetClient && "focus" in targetClient) {
            return targetClient.focus();
          }
          if ("focus" in client) {
            return client.focus();
          }
          return undefined;
        });
      }

      if ("focus" in client) {
        postMeetRequestToClient(client, data);
        return client.focus();
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(resolvedUrl).then((client) => {
        postMeetRequestToClient(client, data);
        return client;
      });
    }
    return undefined;
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = getNotificationData(event.notification);
  const targetUrl = getNotificationTargetUrl(data);

  event.waitUntil(focusOrOpenTarget(targetUrl, data));
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
          message: data.message,
          url: data.url || (data.requestId ? `/?meetRequestId=${encodeURIComponent(data.requestId)}` : "/"),
        },
      };

      self.registration.showNotification(title, options);
    });
  })
  .catch((error) => {
    console.warn("Messaging service worker initialization failed", error);
  });
