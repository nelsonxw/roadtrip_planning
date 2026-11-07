// End-to-end API smoke test against a running server (npm run start or npm run dev).
// Usage: node scripts/smoke-api.mjs [http://localhost:3000]
const base = process.argv[2] ?? "http://localhost:3000";
const failures = [];

function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!condition) failures.push(label);
}

async function call(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}

async function register(label) {
  const res = await call("/api/auth/register", { method: "POST", body: { email: `${label}-${Date.now()}@smoke.test`, password: "password123" } });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  return { status: res.status, cookie };
}

const owner = await register("owner");
check("register returns a session cookie", owner.status === 201 && owner.cookie?.startsWith("rt_session="));
const other = await register("other");

const created = await call("/api/trips", {
  method: "POST",
  cookie: owner.cookie,
  body: {
    name: "Smoke trip",
    durationDays: 3,
    startDate: "2026-07-01",
    origin: { name: "Austin, TX, USA", latitude: 30.2672, longitude: -97.7431 },
    destination: { name: "Denver, CO, USA", latitude: 39.7392, longitude: -104.9903 },
  },
});
check("create trip", created.status === 201, `status ${created.status}`);
const tripId = created.data.id;

let trip = (await call(`/api/trips/${tripId}`, { cookie: owner.cookie })).data;
check("route calculated for origin to destination", trip.legs.length === 1 && trip.legs[0].status === "ok", trip.legs[0]?.provider);
check("itinerary has one driving day for a short trip", trip.itinerary.days.length >= 1);

const add = await call(`/api/trips/${tripId}/operations`, {
  method: "POST",
  cookie: owner.cookie,
  body: {
    expectedVersion: trip.version,
    summary: "Add Santa Fe",
    operations: [{ type: "add_stop", name: "Santa Fe, NM, USA", address: "", latitude: 35.687, longitude: -105.9378, stopType: "required", source: "user", notes: "", visitMinutes: 120 }],
  },
});
check("add required stop", add.status === 200 && add.data.stops.some((s) => s.name === "Santa Fe, NM, USA"));
trip = add.data;

const stale = await call(`/api/trips/${tripId}/operations`, {
  method: "POST",
  cookie: owner.cookie,
  body: { expectedVersion: 1, summary: "stale", operations: [{ type: "optimize_order" }] },
});
check("stale version is rejected with 409", stale.status === 409, `status ${stale.status}`);

const chat = await call(`/api/trips/${tripId}/chat`, { method: "POST", cookie: owner.cookie, body: { message: "remove Santa Fe" } });
const proposalMessage = [...chat.data.messages].reverse().find((m) => m.proposal);
check("chat creates a pending proposal", Boolean(proposalMessage) && proposalMessage.proposal.status === "pending");
check("removing a required stop flags confirmation", proposalMessage?.proposal.impact.requiresConfirmation === true);
check("proposal reports real route impact fields", typeof proposalMessage?.proposal.impact.deltaDriveSeconds === "number");

const unconfirmed = await call(`/api/trips/${tripId}/proposals/${proposalMessage.proposal.id}`, { method: "POST", cookie: owner.cookie, body: { action: "accept", confirmRequired: false } });
check("accepting without confirmation is refused", unconfirmed.status === 409 && unconfirmed.data.code === "confirmation_required");

const accepted = await call(`/api/trips/${tripId}/proposals/${proposalMessage.proposal.id}`, { method: "POST", cookie: owner.cookie, body: { action: "accept", confirmRequired: true } });
check("confirmed accept removes the stop", accepted.status === 200 && !accepted.data.trip.stops.some((s) => s.name === "Santa Fe, NM, USA"));

const undo = await call(`/api/trips/${tripId}/undo`, { method: "POST", cookie: owner.cookie, body: { expectedVersion: accepted.data.trip.version } });
check("undo restores the removed stop", undo.status === 200 && undo.data.stops.some((s) => s.name === "Santa Fe, NM, USA"));

const csv = await call(`/api/trips/${tripId}/export/csv`, { cookie: owner.cookie });
check("CSV export contains the latest itinerary", csv.status === 200 && String(csv.data).includes("Santa Fe, NM, USA") && String(csv.data).startsWith("day,date"));
const pdf = await fetch(`${base}/api/trips/${tripId}/export/pdf`, { headers: { Cookie: owner.cookie } });
const pdfBytes = Buffer.from(await pdf.arrayBuffer());
check("PDF export is a PDF", pdf.status === 200 && pdfBytes.subarray(0, 4).toString() === "%PDF");

const anonymous = await call(`/api/trips/${tripId}`);
check("anonymous read is refused", anonymous.status === 401);
const intruder = await call(`/api/trips/${tripId}`, { cookie: other.cookie });
check("another user cannot read the trip", intruder.status === 404);
const intruderExport = await call(`/api/trips/${tripId}/export/csv`, { cookie: other.cookie });
check("another user cannot export the trip", intruderExport.status === 404);

const geo = await call("/api/geocode?q=denv", { cookie: owner.cookie });
check("geocode autocomplete returns candidates with coordinates", geo.status === 200 && geo.data.results.every((r) => typeof r.latitude === "number"), `mode ${geo.data.mode}`);

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
