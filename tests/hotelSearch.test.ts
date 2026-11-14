import { afterEach, describe, expect, it, vi } from "vitest";
import { GeoapifyPlacesService } from "@/services/places/geoapify";
import { filterHotels } from "@/components/workspace/hotelSearch";
import { OpenRouteServiceGeocoding } from "@/services/geocoding/openrouteservice";

describe("GeoapifyPlacesService.searchHotels", () => {
  afterEach(() => vi.restoreAllMocks());

  it("searches a circle around the stop for hotels and drops listings without a name", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [
            { properties: { name: "Plains Inn", lat: 33.5, lon: -101.9, formatted: "1 Main St", place_id: "inn" } },
            { properties: { lat: 33.5, lon: -101.9, place_id: "unnamed" } },
          ],
        }),
      ),
    );

    const hotels = await new GeoapifyPlacesService("test-key").searchHotels([-101.9, 33.5], 16093.44);

    expect(hotels).toEqual([{ externalId: "inn", name: "Plains Inn", address: "1 Main St", latitude: 33.5, longitude: -101.9 }]);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.categories).toEqual(["accommodation.hotel"]);
    expect(body.filter).toEqual({ type: "circle", lon: -101.9, lat: 33.5, radius: 16093.44 });
  });
});

describe("OpenRouteServiceGeocoding", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves full addresses through the search endpoint, not autocomplete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ features: [{ geometry: { coordinates: [-101.9, 35.1] }, properties: { label: "South Soncy Road, Amarillo, TX, USA", confidence: 0.8 } }] })),
    );

    const [match] = await new OpenRouteServiceGeocoding("test-key").resolve("2302 S Soncy Rd, Amarillo, TX 79124", 6);

    expect(String(fetchSpy.mock.calls[0][0])).toContain("/geocode/search?");
    expect(match).toMatchObject({ latitude: 35.1, longitude: -101.9 });
    await new OpenRouteServiceGeocoding("test-key").search("Amarillo", 6);
    expect(String(fetchSpy.mock.calls[1][0])).toContain("/geocode/autocomplete?");
  });
});

describe("filterHotels", () => {
  const hotels = [
    { externalId: "a", name: "Plains Inn", address: "1 Main St, Amarillo", latitude: 0, longitude: 0 },
    { externalId: "b", name: "Lone Star Motel", address: "9 Route 66", latitude: 0, longitude: 0 },
  ];

  it("keeps every hotel for an empty query", () => {
    expect(filterHotels(hotels, "  ")).toHaveLength(2);
  });

  it("matches name or address, ignoring case", () => {
    expect(filterHotels(hotels, "inn").map((hotel) => hotel.externalId)).toEqual(["a"]);
    expect(filterHotels(hotels, "ROUTE 66").map((hotel) => hotel.externalId)).toEqual(["b"]);
    expect(filterHotels(hotels, "hilton")).toEqual([]);
  });
});
