import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { env } from "@/lib/env";

let client: Firestore | undefined;

/**
 * Hosts such as Vercel have no key file, so the whole service-account JSON can be given in
 * FIREBASE_SERVICE_ACCOUNT_JSON. Locally, GOOGLE_APPLICATION_CREDENTIALS points at the file.
 */
function firebaseCredential() {
  return env.FIREBASE_SERVICE_ACCOUNT_JSON ? cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount) : applicationDefault();
}

/** One shared Firestore client for the server. */
export function getDb(): Firestore {
  if (!client) {
    if (getApps().length === 0) initializeApp({ credential: firebaseCredential(), projectId: env.FIREBASE_PROJECT_ID });
    client = getFirestore();
  }
  return client;
}
