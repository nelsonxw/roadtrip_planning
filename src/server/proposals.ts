import { Prisma } from "@prisma/client";
import { tripOperationSchema, type TripOperation } from "@/domain/trip";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getServices } from "@/services/providers";
import { assertProposalNotStale, planFromMessage, simulateImpact, type ProposalImpact } from "./assistant";
import { applyTripChange, getTripView } from "./tripService";
import { z } from "zod";

export type ChatMessageView = { id: string; role: string; content: string; proposal: ProposalView | null; createdAt: string };
export type ProposalView = { id: string; summary: string; operations: TripOperation[]; impact: ProposalImpact; status: string };

const storedOperations = z.array(tripOperationSchema);

async function requireOwnedTrip(tripId: string, ownerId: string) {
  const trip = await db.trip.findFirst({ where: { id: tripId, ownerId }, select: { id: true, version: true } });
  if (!trip) throw new AppError(404, "trip_not_found", "Trip not found.");
  return trip;
}

function toProposalView(row: { id: string; summary: string; operations: Prisma.JsonValue; impact: Prisma.JsonValue; status: string }): ProposalView {
  return { id: row.id, summary: row.summary, operations: storedOperations.parse(row.operations), impact: row.impact as unknown as ProposalImpact, status: row.status };
}

export async function listChat(tripId: string, ownerId: string): Promise<ChatMessageView[]> {
  await requireOwnedTrip(tripId, ownerId);
  const messages = await db.chatMessage.findMany({ where: { tripId }, orderBy: { createdAt: "asc" }, take: 200 });
  const proposalIds = messages.flatMap((m) => (m.metadata && typeof m.metadata === "object" && "proposalId" in m.metadata ? [String((m.metadata as { proposalId: string }).proposalId)] : []));
  const proposals = proposalIds.length ? await db.tripProposal.findMany({ where: { id: { in: proposalIds } } }) : [];
  return messages.map((message) => {
    const proposalId = message.metadata && typeof message.metadata === "object" && "proposalId" in message.metadata ? String((message.metadata as { proposalId: string }).proposalId) : null;
    const proposal = proposalId ? proposals.find((p) => p.id === proposalId) : undefined;
    return { id: message.id, role: message.role, content: message.content, proposal: proposal ? toProposalView(proposal) : null, createdAt: message.createdAt.toISOString() };
  });
}

/** Handles one user message: records it, plans a reply, and stores any proposed change for the user to accept. */
export async function handleChatMessage(input: { tripId: string; ownerId: string; message: string }) {
  await requireOwnedTrip(input.tripId, input.ownerId);
  const services = getServices();
  const view = await getTripView(input.tripId, input.ownerId, services);
  const plan = await planFromMessage(view, input.message, services);

  await db.chatMessage.create({ data: { tripId: input.tripId, role: "user", content: input.message } });
  let proposalId: string | null = null;
  if (plan.operations.length) {
    const impact = await simulateImpact(view, plan.operations, services);
    const proposal = await db.tripProposal.create({
      data: { tripId: input.tripId, summary: plan.summary, operations: plan.operations as unknown as Prisma.InputJsonValue, impact: impact as unknown as Prisma.InputJsonValue },
    });
    proposalId = proposal.id;
  }
  await db.chatMessage.create({
    data: { tripId: input.tripId, role: "assistant", content: plan.reply, metadata: proposalId ? { proposalId } : undefined },
  });
  return listChat(input.tripId, input.ownerId);
}

export async function acceptProposal(input: { tripId: string; ownerId: string; proposalId: string; confirmRequired: boolean }) {
  const trip = await requireOwnedTrip(input.tripId, input.ownerId);
  const proposal = await db.tripProposal.findFirst({ where: { id: input.proposalId, tripId: input.tripId } });
  if (!proposal) throw new AppError(404, "proposal_not_found", "That suggestion no longer exists.");
  if (proposal.status !== "pending") throw new AppError(409, "proposal_closed", `This suggestion was already ${proposal.status}.`);
  const impact = proposal.impact as unknown as ProposalImpact;
  assertProposalNotStale(impact.baseVersion, trip.version);
  if (impact.requiresConfirmation && !input.confirmRequired) {
    throw new AppError(409, "confirmation_required", "This suggestion removes a required stop. Confirm to apply it.");
  }

  const operations = storedOperations.parse(proposal.operations).map((op) => (op.type === "remove_stop" ? { ...op, confirmRequired: input.confirmRequired } : op));
  // applyTripChange checks the version atomically, so a double-click cannot apply the change twice.
  await applyTripChange({ tripId: input.tripId, ownerId: input.ownerId, expectedVersion: impact.baseVersion, operations, summary: proposal.summary });
  await db.tripProposal.update({ where: { id: proposal.id }, data: { status: "accepted" } });
  await db.chatMessage.create({ data: { tripId: input.tripId, role: "system", content: `Applied: ${proposal.summary}.` } });
  return getTripView(input.tripId, input.ownerId);
}

export async function rejectProposal(input: { tripId: string; ownerId: string; proposalId: string }) {
  await requireOwnedTrip(input.tripId, input.ownerId);
  const updated = await db.tripProposal.updateMany({ where: { id: input.proposalId, tripId: input.tripId, status: "pending" }, data: { status: "rejected" } });
  if (updated.count === 0) throw new AppError(409, "proposal_closed", "This suggestion is no longer pending.");
}
