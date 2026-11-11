import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { listTripsForOwner } from "@/server/tripService";
import { NewTripForm } from "@/components/NewTripForm";
import { SignOutButton } from "@/components/SignOutButton";
import { ClearHistoricalTrips } from "@/components/ClearHistoricalTrips";
import { TripList } from "@/components/TripList";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const trips = await listTripsForOwner(user.id);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold text-slate-900">RoadTrip AI</h1>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <span className="hidden sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-8 p-6 md:grid-cols-[1fr_360px]">
        <section aria-labelledby="trips-heading">
          <h2 id="trips-heading" className="text-lg font-semibold text-slate-900">Your trips</h2>
          <ClearHistoricalTrips />
          {trips.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No trips yet. Create one to start planning.</p>
          ) : (
            <TripList trips={trips} />
          )}
        </section>
        <section aria-labelledby="new-trip-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 id="new-trip-heading" className="text-lg font-semibold text-slate-900">New trip</h2>
          <NewTripForm />
        </section>
      </div>
    </main>
  );
}
