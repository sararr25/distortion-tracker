"use client";

import type { User } from "firebase/auth";
import { get, ref, serverTimestamp, set } from "firebase/database";
import { db, firebaseApp } from "@/lib/firebase";

const messagingModulePromise = import("firebase/messaging");
const MESSAGING_SERVICE_WORKER_PATH = "/api/firebase-messaging-sw";

function safeTokenId(token: string) {
  return encodeURIComponent(token);
}

async function resolveVapidKey() {
  const envVapid = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || process.env.PUBLIC_FIREBASE_VAPID_KEY;
  if (envVapid) return envVapid;

  const response = await fetch("/api/firebase-init", { cache: "no-store" });
  if (!response.ok) return null;

  const config = await response.json() as { vapidKey?: string | null };
  return config.vapidKey ?? null;
}

export async function isPushSupported() {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;

  const { isSupported } = await messagingModulePromise;
  return isSupported();
}

async function getMessagingClient() {
  const { getMessaging } = await messagingModulePromise;
  return getMessaging(firebaseApp);
}

export async function getPushRegistration() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;

  const registration = await navigator.serviceWorker.register(
    MESSAGING_SERVICE_WORKER_PATH,
    {
      scope: "/",
      updateViaCache: "none",
    }
  );

  await registration.update().catch(() => undefined);
  return registration;
}

export async function requestNotificationPermissionAndToken(user: User) {
  if (!(await isPushSupported())) {
    return { status: "unsupported" as const };
  }

  if (Notification.permission === "denied") {
    return { status: "blocked" as const };
  }

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (permission !== "granted") {
    return { status: permission === "denied" ? ("blocked" as const) : ("disabled" as const) };
  }

  const messaging = await getMessagingClient();
  const registration = await getPushRegistration();
  const { getToken } = await messagingModulePromise;
  const vapidKey = await resolveVapidKey();

  if (!registration) {
    return { status: "unsupported" as const };
  }

  if (!vapidKey) {
    return { status: "error" as const, error: new Error("Missing VAPID key") };
  }

  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });

  console.info("FCM token obtained:", token ? "yes" : "no");

  if (!token) {
    return { status: "error" as const, error: new Error("No FCM token returned.") };
  }

  await saveFcmTokenForUser(user, token);
  return { status: "enabled" as const, token };
}

export async function saveFcmTokenForUser(user: User, token: string) {
  const tokenRef = ref(db, `notificationTokens/${user.uid}/${safeTokenId(token)}`);
  const snapshot = await get(tokenRef);
  const existing = snapshot.exists() ? snapshot.val() as { createdAt?: number } : null;

  await set(tokenRef, {
    token,
    uid: user.uid,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    platform: typeof navigator !== "undefined" ? navigator.platform : "",
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: serverTimestamp(),
    enabled: true,
  });

  console.info("FCM token saved to Firebase");
}

export async function listenForForegroundMessages(
  callback: (payload: { data?: Record<string, string> }) => void
) {
  if (!(await isPushSupported())) {
    return () => undefined;
  }

  const messaging = await getMessagingClient();
  const { onMessage } = await messagingModulePromise;
  return onMessage(messaging, callback);
}

export async function hasSavedFcmToken(user: User) {
  const tokenRoot = ref(db, `notificationTokens/${user.uid}`);
  const snapshot = await get(tokenRoot);
  return snapshot.exists();
}
