import { NextRequest, NextResponse } from "next/server";
import { getMessaging } from "firebase-admin/messaging";
import { getFirebaseAdminDatabase, getFirebaseAdminApp } from "@/lib/firebase-admin";

type MeetPushPayload = {
  requestId: string;
  fromUid: string;
  fromName: string;
  fromEmoji: string;
  lat: number;
  lng: number;
  message: string;
};

type TokenRecord = {
  token?: string;
  uid?: string;
  enabled?: boolean;
};

function isValidPayload(payload: unknown): payload is MeetPushPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.requestId === "string" &&
    typeof candidate.fromUid === "string" &&
    typeof candidate.fromName === "string" &&
    typeof candidate.fromEmoji === "string" &&
    typeof candidate.lat === "number" &&
    typeof candidate.lng === "number" &&
    typeof candidate.message === "string"
  );
}

function methodNotAllowed() {
  return NextResponse.json({ success: false, error: "Method not allowed" }, { status: 405 });
}

export function GET() {
  return methodNotAllowed();
}

export function PUT() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
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

  const db = getFirebaseAdminDatabase();
  const tokensSnapshot = await db.ref("notificationTokens").get();
  const allTokens = tokensSnapshot.val() as Record<string, Record<string, TokenRecord>> | null;

  const tokenEntries: Array<{ uid: string; token: string; tokenId: string }> = [];
  if (allTokens) {
    for (const [uid, tokenGroup] of Object.entries(allTokens)) {
      if (uid === payload.fromUid) continue;
      for (const [tokenId, record] of Object.entries(tokenGroup ?? {})) {
        if (!record?.enabled || !record.token) continue;
        tokenEntries.push({ uid, token: record.token, tokenId });
      }
    }
  }

  const uniqueTokens = new Map<string, { uid: string; tokenId: string }>();
  for (const entry of tokenEntries) {
    if (!uniqueTokens.has(entry.token)) {
      uniqueTokens.set(entry.token, { uid: entry.uid, tokenId: entry.tokenId });
    }
  }

  const messaging = getMessaging();
  const tokens = Array.from(uniqueTokens.keys());

  if (tokens.length === 0) {
    return NextResponse.json({ success: true, sentCount: 0, failedCount: 0 });
  }

  const responses = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: `Meet request from ${payload.fromName} ${payload.fromEmoji}`,
      body: "Tap to open the Distortion map",
    },
    data: {
      type: "meet",
      requestId: payload.requestId,
      fromUid: payload.fromUid,
      fromName: payload.fromName,
      fromEmoji: payload.fromEmoji,
      lat: String(payload.lat),
      lng: String(payload.lng),
      url: "/",
    },
    webpush: {
      headers: {
        Urgency: "high",
      },
      notification: {
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        vibrate: [200, 100, 200, 100, 400],
        requireInteraction: true,
      },
    },
  });

  const invalidTokenPaths: string[] = [];
  let failedCount = 0;

  responses.responses.forEach((response, index) => {
    if (response.success) return;
    failedCount += 1;
    const errorCode = response.error?.code ?? "";
    if (errorCode.includes("registration-token-not-registered") || errorCode.includes("invalid-registration-token")) {
      const token = tokens[index];
      const owner = uniqueTokens.get(token);
      if (owner) {
        invalidTokenPaths.push(`notificationTokens/${owner.uid}/${owner.tokenId}`);
      }
    }
  });

  await Promise.all(invalidTokenPaths.map((path) => db.ref(path).remove().catch(() => undefined)));

  return NextResponse.json({
    success: true,
    sentCount: responses.successCount,
    failedCount,
  });
}
