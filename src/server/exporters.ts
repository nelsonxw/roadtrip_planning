import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { formatDistance, formatDuration } from "@/lib/format";
import type { TripView } from "./tripService";

/** Exports are built from the saved trip state the caller loaded, so they always match the latest itinerary. */

const TYPE_LABEL: Record<string, string> = { origin: "Start", destination: "Destination", required: "Required", optional: "Optional", return: "Return to start" };
const METERS_PER_MILE = 1609.344;
const CSV_COLUMNS = [
  "day", "date", "leg", "start_location", "end_location",
  "end_type", "end_source", "end_address", "drive_miles", "drive_min", "route_status", "visit_minutes", "visit_minutes_is_estimate",
  "overnight", "notes", "generated_at",
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

/**
 * One row per driving leg: start location and end location, in route order. Each leg belongs to the
 * day on which it is driven, which is the day the end stop is first reached by car. Rest days have no legs.
 */
export function buildItineraryCsv(view: TripView, generatedAt: Date): string {
  const stopsById = new Map(view.stops.map((stop) => [stop.id, stop]));
  const legInfoByEndStop = new Map<string, { day: number; date: string; overnight: boolean; visitMinutes: number; visitIsEstimate: boolean }>();
  for (const day of view.itinerary.days) {
    for (const item of day.items) {
      if (!item.fromPrevious || legInfoByEndStop.has(item.stopId)) continue;
      legInfoByEndStop.set(item.stopId, {
        day: day.dayNumber,
        date: day.date ?? "",
        overnight: day.overnightStopId === item.stopId,
        visitMinutes: item.visitMinutes,
        visitIsEstimate: item.visitMinutesIsEstimate,
      });
    }
  }

  const rows = view.legs.map((leg, index) => {
    const start = stopsById.get(leg.fromStopId)!;
    const end = stopsById.get(leg.toStopId)!;
    const info = legInfoByEndStop.get(end.id);
    const routed = leg.status === "ok";
    return {
      day: info?.day ?? "",
      date: info?.date ?? "",
      leg: index + 1,
      start_location: start.name,
      end_location: end.name,
      end_type: TYPE_LABEL[end.stopType] ?? end.stopType,
      end_source: end.source,
      end_address: end.address,
      drive_miles: routed ? (leg.distanceMeters / METERS_PER_MILE).toFixed(1) : "",
      drive_min: routed ? Math.round(leg.durationSeconds / 60) : "",
      route_status: leg.status,
      visit_minutes: info?.visitMinutes ?? "",
      visit_minutes_is_estimate: info ? (info.visitIsEstimate ? "yes" : "no") : "",
      overnight: info?.overnight ? "yes" : "no",
      notes: end.notes,
      generated_at: generatedAt.toISOString(),
    };
  });
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
      `Place data: © OpenStreetMap contributors (ODbL).${view.places.some((p) => p.source.includes("Geoapify")) ? " Powered by Geoapify." : ""} Visit lengths and times are estimates. Opening hours are not verified. Routing estimates come from the configured routing provider.`,
    );
    doc.end();
  });
}
