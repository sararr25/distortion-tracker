import { NextRequest, NextResponse } from "next/server";
import { getMessaging } from "firebase-admin/messaging";
import { getFirebaseAdminApp, getFirebaseAdminDatabase } from "@/lib/firebase-admin";

type PulsePushPayload = {
  fromName: string;
  fromEmoji: string;
  senderUid: string;
  recipients?: string[] | null;
};

type TokenRecord = {
  token?: string;
  enabled?: boolean;
};

function isValidPayload(payload: unknown): payload is PulsePushPayload {
  if (!payload || typeof payload !== "object") return false;

  const candidate = payload as Record<string, unknown>;
  const recipients = candidate.recipients;
  const validRecipients =
    recipients === undefined ||
    recipients === null ||
    (Array.isArray(recipients) && recipients.every((uid) => typeof uid === "string"));

  return (
    typeof candidate.fromName === "string" &&
    typeof candidate.fromEmoji === "string" &&
    typeof candidate.senderUid === "string" &&
    validRecipients
  );
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidPayload(payload)) {
    return NextResponse.json({ success: false, error: "Invalid payload" }, { status: 400 });
  }

  try {
    getFirebaseAdminApp();
  } catch (error) {
    console.error("Firebase Admin initialization failed:", error);
    return NextResponse.json({ success: false, error: "Firebase admin unavailable" }, { status: 500 });
  }

  try {
    const db = getFirebaseAdminDatabase();
    const tokensSnapshot = await db.ref("notificationTokens").get();
    const allTokens = tokensSnapshot.val() as Record<string, Record<string, TokenRecord>> | null;
    const recipientUids = Array.isArray(payload.recipients) ? new Set(payload.recipients) : null;
    const uniqueTokens = new Map<string, { uid: string; tokenId: string }>();

    if (allTokens) {
      for (const [uid, tokenGroup] of Object.entries(allTokens)) {
        if (uid === payload.senderUid) continue;
        if (recipientUids && !recipientUids.has(uid)) continue;

        for (const [tokenId, record] of Object.entries(tokenGroup ?? {})) {
          if (!record?.enabled || !record.token || uniqueTokens.has(record.token)) continue;
          uniqueTokens.set(record.token, { uid, tokenId });
        }
      }
    }

    const tokens = Array.from(uniqueTokens.keys());
    if (tokens.length === 0) {
      return NextResponse.json({ success: true, sent: 0, failed: 0, reason: "no recipients" });
    }

    const messaging = getMessaging();
    const invalidTokenPaths: string[] = [];
    let sent = 0;
    let failed = 0;

    for (let index = 0; index < tokens.length; index += 500) {
      const batchTokens = tokens.slice(index, index + 500);
      const response = await messaging.sendEachForMulticast({
        tokens: batchTokens,
        notification: {
          title: `${payload.fromEmoji} ${payload.fromName} sent a pulse!`,
          body: "Tap to find them on the map",
        },
        android: {
          priority: "high",
          ttl: 60000,
          notification: {
            channelId: "pulse-urgent",
            sound: "default",
            defaultSound: true,
            vibrateTimingsMillis: [0, 500, 100, 500, 100, 800],
            defaultVibrateTimings: false,
            priority: "max",
            notificationCount: 1,
            localOnly: false,
          },
        },
        apns: {
          headers: {
            "apns-priority": "10",
            "apns-push-type": "alert",
            "apns-expiration": "0",
          },
          payload: {
            aps: {
              alert: {
                title: `${payload.fromEmoji} ${payload.fromName} sent a pulse!`,
                body: "Tap to find them on the map",
              },
              sound: {
                critical: false,
                name: "default",
                volume: 1,
              },
              badge: 1,
              contentAvailable: true,
              "interruption-level": "time-sensitive",
            },
          },
        },
        webpush: {
          headers: {
            Urgency: "high",
            TTL: "60",
          },
          notification: {
            title: `${payload.fromEmoji} ${payload.fromName} sent a pulse!`,
            body: "Tap to find them on the map",
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            vibrate: [500, 100, 500, 100, 800],
            requireInteraction: false,
            silent: false,
            tag: "pulse",
            renotify: true,
          },
          fcmOptions: {},
        },
      });

      sent += response.successCount;
      failed += response.failureCount;

      response.responses.forEach((result, responseIndex) => {
        if (result.success) return;

        const errorCode = result.error?.code ?? "";
        if (
          errorCode.includes("registration-token-not-registered") ||
          errorCode.includes("invalid-registration-token")
        ) {
          const token = batchTokens[responseIndex];
          const owner = uniqueTokens.get(token);
          if (owner) {
            invalidTokenPaths.push(`notificationTokens/${owner.uid}/${owner.tokenId}`);
          }
        }
      });
    }

    await Promise.all(
      invalidTokenPaths.map((path) => db.ref(path).remove().catch(() => undefined))
    );

    console.info(`Pulse FCM result: sent=${sent} failed=${failed}`);
    return NextResponse.json({ success: true, sent, failed });
  } catch (error) {
    console.error("send-pulse error:", error);
    return NextResponse.json({ success: false, error: "Pulse push failed" }, { status: 500 });
  }
}
