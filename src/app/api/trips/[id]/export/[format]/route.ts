import { AppError } from "@/lib/errors";
import { buildItineraryCsv, buildItineraryPdf } from "@/server/exporters";
import { getTripView } from "@/server/tripService";
import { authedRoute } from "@/server/api";

const safeFileName = (name: string) => name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "trip";

export const GET = authedRoute<{ id: string; format: string }>(async (_request, user, { id, format }) => {
  const view = await getTripView(id, user.id);
  const generatedAt = new Date();
  const base = `${safeFileName(view.name)}-itinerary-${generatedAt.toISOString().slice(0, 10)}`;

  if (format === "csv") {
    return new Response(buildItineraryCsv(view, generatedAt), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "no-store" },
    });
  }
  if (format === "pdf") {
    const pdf = await buildItineraryPdf(view, generatedAt);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"`, "Cache-Control": "no-store" },
    });
  }
  throw new AppError(404, "unknown_format", "Unsupported export format.");
});
