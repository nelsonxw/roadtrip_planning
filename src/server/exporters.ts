import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { formatDistance, formatDuration } from "@/lib/format";
import type { TripView } from "./tripService";

/** Exports are built from the saved trip state the caller loaded, so they always match the latest itinerary. */

const TYPE_LABEL: Record<string, string> = { origin: "Start", destination: "Destination", required: "Required", optional: "Optional" };
const CSV_COLUMNS = [
  "day", "date", "order", "stop", "type", "source", "address", "latitude", "longitude", "drive_from_previous_km", "drive_from_previous_min",
  "route_status", "visit_minutes", "visit_minutes_is_estimate", "overnight", "notes", "generated_at",
];

/**
 * Spreadsheet apps run text starting with = + - @ as a formula. Stop names and notes come from users,
 * so such cells are prefixed with an apostrophe to keep them as plain text.
 */
export function neutralizeFormulas(row: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...row };
  for (const key of Object.keys(output)) {
    const value = output[key];
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(value)) output[key] = `'${value}`;
  }
  return output;
}

export function buildItineraryCsv(view: TripView, generatedAt: Date): string {
  const stopsById = new Map(view.stops.map((stop) => [stop.id, stop]));
  const rows = view.itinerary.days.flatMap((day) =>
    day.items.map((item, index) => {
      const stop = stopsById.get(item.stopId)!;
      return {
        day: day.dayNumber,
        date: day.date ?? "",
        order: index + 1,
        stop: stop.name,
        type: TYPE_LABEL[stop.stopType] ?? stop.stopType,
        source: stop.source,
        address: stop.address,
        latitude: stop.latitude,
        longitude: stop.longitude,
        drive_from_previous_km: item.fromPrevious ? (item.fromPrevious.distanceMeters / 1000).toFixed(1) : "",
        drive_from_previous_min: item.fromPrevious ? Math.round(item.fromPrevious.durationSeconds / 60) : "",
        route_status: item.fromPrevious ? item.fromPrevious.status : "",
        visit_minutes: item.visitMinutes,
        visit_minutes_is_estimate: item.visitMinutesIsEstimate ? "yes" : "no",
        overnight: day.overnightStopId === stop.id ? "yes" : "no",
        notes: stop.notes,
        generated_at: generatedAt.toISOString(),
      };
    }),
  );
  return stringify(rows.map(neutralizeFormulas), { header: true, columns: CSV_COLUMNS });
}

export function buildItineraryPdf(view: TripView, generatedAt: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48, info: { Title: `${view.name} - itinerary`, Author: "RoadTrip AI" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const stopsById = new Map(view.stops.map((stop) => [stop.id, stop]));
    doc.font("Helvetica-Bold").fontSize(20).text(view.name);
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text(`Generated ${generatedAt.toISOString()} (UTC) from the latest saved trip, version ${view.version}`);
    if (view.startDate) doc.text(`Starts ${view.startDate}${view.durationDays ? ` · ${view.durationDays} days planned` : ""}`);
    doc.moveDown(0.6);

    const { totals } = view.itinerary;
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11).text("Route summary");
    doc.font("Helvetica").fontSize(10).text(
      `Driving: ${formatDistance(totals.distanceMeters)}, ${formatDuration(totals.driveDurationSeconds)} (provider estimate; excludes breaks, traffic and time at stops). ` +
        `${totals.drivingDays} driving day(s). Stops: ${view.stops.length}.`,
    );
    if (view.modes.routing === "demo") doc.fillColor("#b45309").text("DEMO DATA: route distances and times are straight-line estimates, not live road data.").fillColor("#0f172a");
    doc.moveDown(0.6);

    if (view.itinerary.warnings.length) {
      doc.font("Helvetica-Bold").text("Warnings");
      doc.font("Helvetica").fillColor("#b45309");
      view.itinerary.warnings.forEach((warning) => doc.text(`- ${warning}`));
      doc.fillColor("#0f172a").moveDown(0.6);
    }

    for (const day of view.itinerary.days) {
      if (doc.y > 680) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).text(`Day ${day.dayNumber}${day.date ? ` - ${day.date}` : ""}${day.kind === "rest" ? " (no driving)" : ""}`);
      doc.font("Helvetica").fontSize(9).fillColor("#475569").text(`${formatDistance(day.driveDistanceMeters)} · ${formatDuration(day.driveDurationSeconds)} driving · visits about ${formatDuration(day.visitMinutes * 60)} (estimate)${day.overnightStopId ? ` · overnight: ${stopsById.get(day.overnightStopId)?.name ?? ""}` : ""}`);
      doc.fillColor("#0f172a").fontSize(10);
      day.items.forEach((item, index) => {
        const stop = stopsById.get(item.stopId)!;
        const drive = item.fromPrevious
          ? item.fromPrevious.status === "ok"
            ? `${formatDistance(item.fromPrevious.distanceMeters)}, ${formatDuration(item.fromPrevious.durationSeconds)} from previous`
            : "route not calculated"
          : "start";
        doc.font("Helvetica-Bold").text(`${index + 1}. ${stop.name}`, { continued: true }).font("Helvetica").text(`  [${TYPE_LABEL[stop.stopType] ?? stop.stopType}]`);
        doc.fontSize(9).fillColor("#334155").text(`   ${drive}${stop.stopType === "origin" ? "" : ` · visit ~${formatDuration(item.visitMinutes * 60)}${item.visitMinutesIsEstimate ? " (estimate)" : ""}`}`);
        if (stop.notes) doc.text(`   Notes: ${stop.notes}`);
        doc.fillColor("#0f172a").fontSize(10);
      });
      doc.moveDown(0.5);
    }

    const sources = view.places.filter((place) => place.status === "added" && place.sourceUrl);
    if (sources.length) {
      doc.font("Helvetica-Bold").fontSize(11).text("Links for added places");
      doc.font("Helvetica").fontSize(9);
      sources.forEach((place) => doc.fillColor("#0369a1").text(`${place.name}: ${place.sourceUrl}`, { link: place.sourceUrl ?? undefined, underline: true }));
      doc.fillColor("#0f172a").moveDown(0.5);
    }

    doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(
      "Place data: OpenStreetMap contributors (ODbL). Descriptions: Wikipedia (CC BY-SA). Visit lengths and times are estimates. Opening hours are not verified. Routing estimates come from the configured routing provider.",
    );
    doc.end();
  });
}
