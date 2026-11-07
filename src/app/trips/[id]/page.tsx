import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { db } from "@/lib/db";
import { TripWorkspace } from "@/components/workspace/TripWorkspace";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  // Ownership is checked here and again on every API call. The page does not render other users' trips.
  const trip = await db.trip.findFirst({ where: { id, ownerId: user.id }, select: { id: true } });
  if (!trip) notFound();
  return (
    <div className="flex h-dvh flex-col">
      <nav className="border-b border-slate-200 bg-white px-4 py-2 text-sm">
        <Link href="/" className="text-sky-700 hover:underline">
          ← All trips
        </Link>
      </nav>
      <TripWorkspace tripId={id} />
    </div>
  );
}
