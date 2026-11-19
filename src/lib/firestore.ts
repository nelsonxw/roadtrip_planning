import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { env } from "@/lib/env";

let client: Firestore | undefined;

/** One shared Firestore client for the server. Credentials come from GOOGLE_APPLICATION_CREDENTIALS. */
export function getDb(): Firestore {
  if (!client) {
    if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId: env.FIREBASE_PROJECT_ID });
    client = getFirestore();
  }
  return client;
}
