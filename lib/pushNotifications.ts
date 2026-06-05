"use client";

import type { User } from "firebase/auth";
import { child, get, ref, serverTimestamp, set, update } from "firebase/database";
import { db, firebaseConfig } from "@/lib/firebase";

const messagingModulePromise = import("firebase/messaging");

function safeTokenId(token: string) {
  return encodeURIComponent(token);
}

export async function isPushSupported() {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;

  const { isSupported } = await messagingModulePromise;
  return isSupported();
}

async function getMessagingClient() {
  const { getMessaging } = await messagingModulePromise;
  return getMessaging();
}

async function getMessagingRegistration() {
  return navigator.serviceWorker.register("/firebase-messaging-sw.js");
}

export async function requestNotificationPermissionAndToken(user: User) {
  if (!(await isPushSupported())) {
    return { status: "unsupported" as const };
  }

  if (Notification.permission === "denied") {
    return { status: "blocked" as const };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { status: permission === "denied" ? ("blocked" as const) : ("disabled" as const) };
  }

  const messaging = await getMessagingClient();
  const registration = await getMessagingRegistration();
  const { getToken } = await messagingModulePromise;
  const token = await getToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });

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

export async function getPushRegistration() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/firebase-messaging-sw.js");
}

export async function hasSavedFcmToken(user: User) {
  const tokenRoot = ref(db, `notificationTokens/${user.uid}`);
  const snapshot = await get(tokenRoot);
  return snapshot.exists();
}
