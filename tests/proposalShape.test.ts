import { describe, expect, it } from "vitest";
import { checkProposalShape, describeOperation } from "@/server/assistant";
import type { Stop, TripOperation } from "@/domain/trip";

const stops: Stop[] = [
  { id: "lubbock", name: "Lubbock", address: "", latitude: 33.5, longitude: -101.9, sequence: 1, stopType: "optional", source: "ai", notes: "", visitMinutes: null },
];

const addAmarillo: TripOperation = { type: "add_stop", name: "Amarillo", address: "", latitude: 35.2, longitude: -101.8, stopType: "optional", leg: "outbound", source: "ai", notes: "", visitMinutes: null };

describe("describeOperation", () => {
  it("names stops in plain words", () => {
    expect(describeOperation(addAmarillo, stops)).toBe("Add Amarillo to the outbound trip");
    expect(describeOperation({ type: "remove_stop", stopId: "lubbock", confirmRequired: false }, stops)).toBe("Remove Lubbock");
    expect(describeOperation({ type: "set_round_trip", enabled: true }, stops)).toBe("Add the return to the start point");
  });
});

describe("checkProposalShape", () => {
  it("refuses a replacement that only adds the new stop", () => {
    expect(checkProposalShape("Replace Lubbock with Amarillo", [addAmarillo])).toMatch(/nothing changed/);
  });

  it("accepts a replacement that removes the old stop and adds the new one", () => {
    expect(checkProposalShape("Replace Lubbock with Amarillo", [{ type: "remove_stop", stopId: "lubbock", confirmRequired: false }, addAmarillo])).toBeNull();
  });

  it("does not affect ordinary proposals", () => {
    expect(checkProposalShape("Add Amarillo", [addAmarillo])).toBeNull();
  });
});
