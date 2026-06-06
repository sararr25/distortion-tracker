import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

let adminApp: App | null = null;

function parseServiceAccount(): ServiceAccount | null {
  const jsonValue =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
    process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;

  if (jsonValue) {
    try {
      return JSON.parse(jsonValue) as ServiceAccount;
    } catch (error) {
      console.warn("Failed to parse Firebase service account JSON:", error);
    }
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) return null;

  return {
    projectId,
    clientEmail,
    privateKey,
  } satisfies ServiceAccount;
}

export function getFirebaseAdminApp() {
  if (adminApp) return adminApp;
  if (getApps().length > 0) {
    adminApp = getApps()[0] ?? null;
    return adminApp;
  }

  const serviceAccount = parseServiceAccount();
  const databaseURL = process.env.FIREBASE_ADMIN_DATABASE_URL || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;

  if (!serviceAccount) {
    throw new Error("Missing Firebase Admin service account environment variables.");
  }

  adminApp = initializeApp({
    credential: cert(serviceAccount),
    databaseURL,
  });

  return adminApp;
}

export function getFirebaseAdminDatabase() {
  return getDatabase(getFirebaseAdminApp()!);
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}
