import { describe, expect, it } from "vitest";
import { suggestedStopsFromProposals } from "@/components/workspace/TripWorkspace";
import type { ChatMessageView, ProposalView } from "@/server/proposals";

const addStop = (name: string) => ({ type: "add_stop" as const, name, address: "", latitude: 35.2, longitude: -101.8, stopType: "required" as const, leg: "outbound" as const, overnight: false, source: "user" as const, notes: "", visitMinutes: null });

const message = (proposal: Partial<ProposalView> | null): ChatMessageView => ({
  id: "m",
  role: "assistant",
  content: "",
  createdAt: "",
  proposal: proposal as ProposalView | null,
});

describe("suggestedStopsFromProposals", () => {
  it("returns the stops a pending proposal would add", () => {
    const stops = suggestedStopsFromProposals([message({ status: "pending", operations: [addStop("Palo Duro Canyon")] })]);
    expect(stops).toEqual([{ name: "Palo Duro Canyon", latitude: 35.2, longitude: -101.8 }]);
  });

  it("ignores proposals that were accepted or rejected", () => {
    const stops = suggestedStopsFromProposals([message({ status: "accepted", operations: [addStop("A")] }), message({ status: "rejected", operations: [addStop("B")] })]);
    expect(stops).toEqual([]);
  });

  it("ignores operations that are not adds, and messages without a proposal", () => {
    const stops = suggestedStopsFromProposals([message(null), message({ status: "pending", operations: [{ type: "remove_stop", stopId: "s", confirmRequired: false }] })]);
    expect(stops).toEqual([]);
  });
});
