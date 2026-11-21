import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getDb } from "@/lib/firestore";
import { TripWorkspace } from "@/components/workspace/TripWorkspace";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  // Ownership is checked here and again on every API call. The page does not render other users' trips.
  const trip = await getDb().collection("trips").doc(id).get();
  if (!trip.exists || trip.data()!.ownerId !== user.id) notFound();
  return (
    <div className="trip-workspace flex h-dvh flex-col bg-sky-100">
      <nav className="border-b border-slate-200 bg-white px-4 py-2 text-sm">
        <Link href="/" className="inline-flex items-center gap-1 rounded-lg border border-sky-500 bg-sky-500 px-3 py-1.5 font-medium text-white hover:bg-sky-600">
          ← All trips
        </Link>
      </nav>
      <TripWorkspace tripId={id} />
    </div>
  );
}
