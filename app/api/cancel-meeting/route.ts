import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdminAuth, getFirebaseAdminDatabase } from "@/lib/firebase-admin";

type CancelMeetingPayload = {
  requestId?: string;
};

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export async function POST(request: NextRequest) {
  const idToken = getBearerToken(request);
  if (!idToken) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: CancelMeetingPayload;
  try {
    payload = await request.json() as CancelMeetingPayload;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const decodedToken = await getFirebaseAdminAuth().verifyIdToken(idToken);
    const db = getFirebaseAdminDatabase();
    const meetingSnapshot = await db.ref("meetingPoint").get();
    const meetingPoint = meetingSnapshot.val() as {
      requestId?: string;
      setByUid?: string;
      uid?: string;
    } | null;
    const activeOwnerUid = meetingPoint?.setByUid ?? meetingPoint?.uid;
    const requestId = payload.requestId || meetingPoint?.requestId;

    let ownsRequest = false;
    if (requestId) {
      const requestSnapshot = await db.ref(`meetingRequests/${requestId}`).get();
      const meetRequest = requestSnapshot.val() as { fromUid?: string } | null;
      ownsRequest = meetRequest?.fromUid === decodedToken.uid;
    }

    if (activeOwnerUid && activeOwnerUid !== decodedToken.uid) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    if (!activeOwnerUid && !ownsRequest) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const updates: Record<string, null> = {
      meetingPoint: null,
      meetingRSVPs: null,
    };
    if (requestId) {
      updates[`meetingRequests/${requestId}`] = null;
    }

    await db.ref().update(updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to cancel meeting:", error);
    return NextResponse.json({ success: false, error: "Cancellation failed" }, { status: 500 });
  }
}
