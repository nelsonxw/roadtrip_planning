import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { listTripsForOwner } from "@/server/tripService";
import { NewTripForm } from "@/components/NewTripForm";
import { SignOutButton } from "@/components/SignOutButton";
import { TripList } from "@/components/TripList";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const trips = await listTripsForOwner(user.id);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = trips.filter((trip) => trip.startDate && trip.startDate >= today).sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1));
  const totalStops = trips.reduce((sum, trip) => sum + trip.stopCount, 0);

  return (
    <main className="relative isolate min-h-screen">
      <div className="fixed inset-0 -z-10 bg-[url('/images/road-trip-glacier.jpg')] bg-cover bg-center" aria-hidden="true" />
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-slate-950/90 via-slate-900/65 to-transparent" aria-hidden="true" />
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500 text-white shadow-sm" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z" />
            </svg>
          </span>
          My Road Trip Planner
        </h1>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <span className="hidden sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-8 p-6 md:grid-cols-[1fr_360px] lg:gap-16">
        <section aria-labelledby="trips-heading" className="self-start rounded-2xl bg-slate-900/40 p-5 text-white shadow-xl ring-1 ring-white/20 backdrop-blur-md">
          <h2 id="trips-heading" className="text-lg font-semibold text-white">Your trips</h2>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "Trips", value: String(trips.length) },
              { label: "Stops", value: String(totalStops) },
              { label: "Next trip", value: upcoming[0]?.startDate ?? "None" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/10 px-3 py-2">
                <dt className="text-xs text-white/70">{stat.label}</dt>
                <dd className="text-base font-semibold text-white">{stat.value}</dd>
              </div>
            ))}
          </dl>
          {trips.length === 0 ? (
            <div className="relative mt-4 flex min-h-28 items-center justify-center rounded-xl border border-dashed border-white/40 p-6 text-center">
              <p className="text-sm text-white">No trips yet. Plan your first road trip in a few steps.</p>
              <Image src="/images/brush-arrow-blue.png" alt="" aria-hidden="true" width={518} height={537} className="route-arrow-head pointer-events-none absolute left-full top-[78%] hidden w-44 h-auto -translate-y-1/2 lg:block motion-reduce:animate-none" />
            </div>
          ) : (
            <div className="mt-4">
              <TripList trips={trips} />
            </div>
          )}
        </section>
        <section aria-labelledby="new-trip-heading" className="self-start rounded-2xl bg-slate-900/40 p-5 text-white shadow-xl ring-1 ring-white/20 backdrop-blur-md">
          <h2 id="new-trip-heading" className="text-lg font-semibold text-white">New trip</h2>
          <NewTripForm />
        </section>
      </div>
    </main>
  );
}
