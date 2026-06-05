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
