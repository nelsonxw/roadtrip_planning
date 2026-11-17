import { describe, expect, it } from "vitest";
import { titleMatchesPlace } from "@/services/places/names";

describe("titleMatchesPlace", () => {
  it("matches the same name ignoring case and punctuation", () => {
    expect(titleMatchesPlace("Mesa Verde National Park.", "Mesa Verde National Park")).toBe(true);
  });

  it("matches a shorter label that the full name contains", () => {
    expect(titleMatchesPlace("Palo Duro Canyon State Park", "Palo Duro State Park")).toBe(false);
    expect(titleMatchesPlace("Palo Duro Canyon State Park", "Palo Duro Canyon")).toBe(true);
  });

  it("does not match a different place that shares only a short word", () => {
    expect(titleMatchesPlace("Ridge Park", "Ridgecrest, Texas")).toBe(false);
  });
});
