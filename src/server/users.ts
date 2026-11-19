import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/firestore";
import { AppError } from "@/lib/errors";

export type StoredUser = { id: string; email: string; passwordHash: string };

/** Email addresses are kept in their own collection, keyed by a hash, so creating an account can check uniqueness in one transaction. */
const emailKey = (email: string) => createHash("sha256").update(email).digest("hex");

export async function findUserById(id: string): Promise<StoredUser | null> {
  const snap = await getDb().collection("users").doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return { id: snap.id, email: data.email, passwordHash: data.passwordHash };
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const index = await getDb().collection("userEmails").doc(emailKey(email)).get();
  if (!index.exists) return null;
  return findUserById(index.data()!.userId);
}

export async function createUser(email: string, passwordHash: string): Promise<StoredUser> {
  const db = getDb();
  const id = randomUUID();
  const indexRef = db.collection("userEmails").doc(emailKey(email));
  await db.runTransaction(async (tx) => {
    if ((await tx.get(indexRef)).exists) throw new AppError(409, "email_taken", "An account with this email already exists. Try signing in.");
    tx.set(indexRef, { userId: id });
    tx.set(db.collection("users").doc(id), { email, passwordHash, createdAt: new Date() });
  });
  return { id, email, passwordHash };
}
