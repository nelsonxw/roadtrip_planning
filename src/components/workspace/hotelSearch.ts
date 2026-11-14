import { api } from "@/lib/clientApi";
import type { GeocodeCandidate, HotelCandidate } from "@/services/types";

/** Hotels found near one overnight stop. The picked hotel fills the add-hotel form. */
export type HotelSearch = { stopId: string; hotels: HotelCandidate[]; pickedId: string | null; query: string };

/** A located address that is not saved yet. Shown on the map so the user can check it before adding the hotel. */
export type PendingHotel = { name: string; latitude: number; longitude: number };

/** Case-insensitive match on name or address. An empty query keeps every hotel. */
export function filterHotels(hotels: HotelCandidate[], query: string): HotelCandidate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return hotels;
  return hotels.filter((hotel) => `${hotel.name} ${hotel.address}`.toLowerCase().includes(needle));
}

/** Coordinates for a typed hotel address, from the app's geocoder. Throws when nothing matches. */
export async function locateAddress(query: string): Promise<{ latitude: number; longitude: number }> {
  const data = await api<{ results: GeocodeCandidate[] }>(`/api/geocode?exact=1&q=${encodeURIComponent(query)}`);
  const match = data.results[0];
  if (!match) throw new Error("That address was not found. Check the spelling, or enter the nearest town.");
  return { latitude: match.latitude, longitude: match.longitude };
}
