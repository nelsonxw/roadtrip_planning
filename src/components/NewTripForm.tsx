"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { post } from "@/lib/clientApi";
import { PlaceSearch, type ChosenPlace } from "./PlaceSearch";

export function NewTripForm() {
  const router = useRouter();
  const [origin, setOrigin] = useState<ChosenPlace | null>(null);
  const [destination, setDestination] = useState<ChosenPlace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!origin || !destination) {
      setError("Choose both the start and the destination from the search results.");
      return;
    }
    const days = Number(form.get("durationDays"));
    setPending(true);
    setError(null);
    try {
      const { id } = await post<{ id: string }>("/api/trips", {
        name: String(form.get("name") || `${origin.name} to ${destination.name}`),
        startDate: String(form.get("startDate") || "") || null,
        durationDays: days > 0 ? days : null,
        origin: { name: origin.name, address: origin.label, latitude: origin.latitude, longitude: origin.longitude },
        destination: { name: destination.name, address: destination.label, latitude: destination.latitude, longitude: destination.longitude },
      });
      router.push(`/trips/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the trip.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <PlaceSearch label="Start" onChoose={setOrigin} />
      <PlaceSearch label="Destination" onChoose={setDestination} />
      <label className="block text-sm font-medium text-slate-700">
        Trip name (optional)
        <input name="name" maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-slate-700">
          Start date
          <input name="startDate" type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Days
          <input name="durationDays" type="number" min={1} max={60} placeholder="e.g. 7" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60">
        {pending ? "Creating..." : "Create trip"}
      </button>
    </form>
  );
}
