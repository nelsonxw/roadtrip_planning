import type { DocumentData } from "firebase-admin/firestore";
import { tripOperationSchema, type TripOperation } from "@/domain/trip";
import { AppError } from "@/lib/errors";
import { getDb } from "@/lib/firestore";
import { getServices } from "@/services/providers";
import { assertProposalNotStale, checkProposalShape, simulateImpact, type ProposalImpact } from "./assistant";
import { planTripChange } from "./aiPlanner";
import { applyTripChange, getTripView } from "./tripService";
import { z } from "zod";

export type ChatMessageView = { id: string; role: string; content: string; proposal: ProposalView | null; createdAt: string };
export type ProposalView = { id: string; summary: string; operations: TripOperation[]; impact: ProposalImpact; status: string };

const storedOperations = z.array(tripOperationSchema);

const tripDoc = (tripId: string) => getDb().collection("trips").doc(tripId);
const messagesRef = (tripId: string) => tripDoc(tripId).collection("messages");
const proposalsRef = (tripId: string) => tripDoc(tripId).collection("proposals");

async function requireOwnedTrip(tripId: string, ownerId: string) {
  const snap = await tripDoc(tripId).get();
  if (!snap.exists || snap.data()!.ownerId !== ownerId) throw new AppError(404, "trip_not_found", "Trip not found.");
  return { id: snap.id, version: snap.data()!.version as number };
}

/** Proposals are stored as JSON text, because Firestore does not allow arrays inside arrays. */
function toProposalView(id: string, data: DocumentData): ProposalView {
  return {
    id,
    summary: data.summary,
    operations: storedOperations.parse(JSON.parse(data.operations)),
    impact: JSON.parse(data.impact) as ProposalImpact,
    status: data.status,
  };
}

function proposalIdOf(metadata: unknown): string | null {
  return metadata && typeof metadata === "object" && "proposalId" in metadata ? String((metadata as { proposalId: string }).proposalId) : null;
}

type ChatRecord = { id: string; role: string; content: string; metadata: unknown; createdAt: unknown };

const toIso = (value: unknown) => (value as { toDate(): Date }).toDate().toISOString();

export async function listChat(tripId: string, ownerId: string): Promise<ChatMessageView[]> {
  await requireOwnedTrip(tripId, ownerId);
  const messageSnaps = await messagesRef(tripId).orderBy("createdAt", "asc").limit(200).get();
  const messages = messageSnaps.docs.map((snap): ChatRecord => ({ id: snap.id, ...(snap.data() as Omit<ChatRecord, "id">) }));
  const proposalIds = [...new Set(messages.flatMap((m) => (proposalIdOf(m.metadata) ? [proposalIdOf(m.metadata)!] : [])))];
  const proposalSnaps = proposalIds.length ? await getDb().getAll(...proposalIds.map((id) => proposalsRef(tripId).doc(id))) : [];
  const proposals = new Map(proposalSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, toProposalView(snap.id, snap.data()!)]));
  return messages.map((message) => {
    const proposalId = proposalIdOf(message.metadata);
    return { id: message.id, role: message.role, content: message.content, proposal: proposalId ? (proposals.get(proposalId) ?? null) : null, createdAt: toIso(message.createdAt) };
  });
}

async function addMessage(tripId: string, role: string, content: string, metadata: { proposalId: string } | null = null) {
  await messagesRef(tripId).add({ role, content, metadata, createdAt: new Date() });
}

/** Handles one user message: records it, plans a reply, and stores any proposed change for the user to accept. */
export async function handleChatMessage(input: { tripId: string; ownerId: string; message: string }) {
  await requireOwnedTrip(input.tripId, input.ownerId);
  const services = getServices();
  const view = await getTripView(input.tripId, input.ownerId, services);
  const recentSnaps = await messagesRef(input.tripId).orderBy("createdAt", "desc").limit(6).get();
  const recent = recentSnaps.docs.map((snap) => snap.data() as { role: string; content: string }).reverse();
  const plan = await planTripChange(view, input.message, recent, services);

  await addMessage(input.tripId, "user", input.message);
  let proposalId: string | null = null;
  const shapeProblem = checkProposalShape(plan.summary, plan.operations);
  if (shapeProblem) {
    await addMessage(input.tripId, "assistant", shapeProblem);
    return listChat(input.tripId, input.ownerId);
  }
  if (plan.operations.length) {
    const impact = await simulateImpact(view, plan.operations, services);
    const proposal = await proposalsRef(input.tripId).add({
      summary: plan.summary,
      operations: JSON.stringify(plan.operations),
      impact: JSON.stringify(impact),
      status: "pending",
      createdAt: new Date(),
    });
    proposalId = proposal.id;
  }
  await addMessage(input.tripId, "assistant", plan.reply, proposalId ? { proposalId } : null);
  return listChat(input.tripId, input.ownerId);
}

export async function acceptProposal(input: { tripId: string; ownerId: string; proposalId: string; confirmRequired: boolean }) {
  const trip = await requireOwnedTrip(input.tripId, input.ownerId);
  const snap = await proposalsRef(input.tripId).doc(input.proposalId).get();
  if (!snap.exists) throw new AppError(404, "proposal_not_found", "That suggestion no longer exists.");
  const proposal = snap.data()!;
  if (proposal.status !== "pending") throw new AppError(409, "proposal_closed", `This suggestion was already ${proposal.status}.`);
  const impact = JSON.parse(proposal.impact) as ProposalImpact;
  assertProposalNotStale(impact.baseVersion, trip.version);
  if (impact.requiresConfirmation && !input.confirmRequired) {
    throw new AppError(409, "confirmation_required", "This suggestion removes a required stop. Confirm to apply it.");
  }

  const operations = storedOperations.parse(JSON.parse(proposal.operations)).map((op) => (op.type === "remove_stop" ? { ...op, confirmRequired: input.confirmRequired } : op));
  // applyTripChange checks the version inside a transaction, so a double-click cannot apply the change twice.
  await applyTripChange({ tripId: input.tripId, ownerId: input.ownerId, expectedVersion: impact.baseVersion, operations, summary: proposal.summary });
  await proposalsRef(input.tripId).doc(input.proposalId).update({ status: "accepted" });
  await addMessage(input.tripId, "system", `Applied: ${proposal.summary}.`);
  return getTripView(input.tripId, input.ownerId);
}

export async function rejectProposal(input: { tripId: string; ownerId: string; proposalId: string }) {
  await requireOwnedTrip(input.tripId, input.ownerId);
  const ref = proposalsRef(input.tripId).doc(input.proposalId);
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()!.status !== "pending") throw new AppError(409, "proposal_closed", "This suggestion is no longer pending.");
    tx.update(ref, { status: "rejected" });
  });
}
