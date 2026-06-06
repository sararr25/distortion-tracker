import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const worker = `
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp(${JSON.stringify(firebaseConfig)});

self.addEventListener("install", function(event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", function(event) {
  event.waitUntil(self.clients.claim());
});

function getNotificationData(notification) {
  var rawData = notification && notification.data ? notification.data : {};
  var fcmData = rawData.FCM_MSG && rawData.FCM_MSG.data ? rawData.FCM_MSG.data : {};
  return Object.assign({}, fcmData, rawData);
}

function getNotificationTargetUrl(data) {
  if (data && data.url) return data.url;
  if (data && data.requestId) {
    return "/?meetRequestId=" + encodeURIComponent(data.requestId);
  }
  return "/";
}

function resolveTargetUrl(targetUrl) {
  try {
    return new URL(targetUrl || "/", self.location.origin).href;
  } catch (error) {
    return new URL("/", self.location.origin).href;
  }
}

function postMeetRequestToClient(client, data) {
  if (!client || !data || !data.requestId) return;
  client.postMessage({
    type: "open-meet-request",
    requestId: data.requestId
  });
}

function focusOrOpenTarget(targetUrl, data) {
  var resolvedUrl = resolveTargetUrl(targetUrl);

  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(clientList) {
    for (var index = 0; index < clientList.length; index += 1) {
      var client = clientList[index];
      if ("navigate" in client) {
        return client.navigate(resolvedUrl).then(function(navigatedClient) {
          var targetClient = navigatedClient || client;
          postMeetRequestToClient(targetClient, data);
          return "focus" in targetClient ? targetClient.focus() : targetClient;
        });
      }
      if ("focus" in client) {
        postMeetRequestToClient(client, data);
        return client.focus();
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(resolvedUrl).then(function(client) {
        postMeetRequestToClient(client, data);
        return client;
      });
    }
  });
}

self.addEventListener("notificationclick", function(event) {
  event.stopImmediatePropagation();
  event.notification.close();

  var data = getNotificationData(event.notification);
  event.waitUntil(focusOrOpenTarget(getNotificationTargetUrl(data), data));
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  if (payload.notification) return;

  var data = payload.data || {};
  var isMeet = data.type === "meet";
  var title = isMeet
    ? "Meet request from " + (data.fromName || "Someone") + " " + (data.fromEmoji || "📍")
    : (data.fromEmoji || "⚡") + " " + (data.fromName || "Someone") + " sent a pulse!";
  var body = isMeet ? "Tap to open the meeting point" : "Tap to find them on the map";
  var url = data.url || (data.requestId ? "/?meetRequestId=" + encodeURIComponent(data.requestId) : "/");

  return self.registration.showNotification(title, {
    body: body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: isMeet ? "meet-" + (data.requestId || "request") : "pulse-" + (data.senderUid || "crew"),
    renotify: true,
    requireInteraction: true,
    vibrate: isMeet ? [200, 100, 200, 100, 400] : [500, 100, 500, 100, 500],
    data: Object.assign({}, data, { url: url })
  });
});
`;

  return new NextResponse(worker, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
