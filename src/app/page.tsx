import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { listTripsForOwner } from "@/server/tripService";
import { NewTripForm } from "@/components/NewTripForm";
import { SignOutButton } from "@/components/SignOutButton";

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
          {trips.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No trips yet. Create one to start planning.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {trips.map((trip) => (
                <li key={trip.id}>
                  <Link href={`/trips/${trip.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300">
                    <span className="font-medium text-slate-900">{trip.name}</span>
                    <span className="mt-1 block text-sm text-slate-600">
                      {trip.stopCount} stops{trip.durationDays ? ` · ${trip.durationDays} days` : ""}{trip.startDate ? ` · starts ${trip.startDate}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
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
