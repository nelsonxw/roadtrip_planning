import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { AuthForm } from "@/components/AuthForm";

const HIGHLIGHTS = [
  "Driving time and distance for every leg of the trip",
  "An assistant that proposes changes and waits for your approval",
  "Hotels near each stop and popular places on the map",
];

const MAIN_ROUTE = "M0 300 H380 Q420 300 420 260 V200 Q420 160 460 160 H700 Q740 160 740 200 V240 Q740 280 780 280 H1100 Q1140 280 1140 240 V120 H1440";
const SIDE_ROADS = ["M1000 400 V340 Q1000 320 1020 320 H1440", "M180 400 V350 Q180 330 200 330 H300", "M1300 120 V40 Q1300 20 1320 20 H1440"];

/** Simple white glyphs drawn on a 24 x 24 grid, one per kind of stop. */
const STOP_GLYPHS = {
  food: "M8 3v7a2 2 0 004 0V3M10 12v9M17 3c-2 1.5-2.5 4-2.5 6.5 0 1.5 1 2.5 2.5 2.5V21",
  hotel: "M4 18V7M4 14h16v4M20 14v-1.5a2.5 2.5 0 00-2.5-2.5H11v4",
  sight: "M3.5 8.5h4l2-2.5h5l2 2.5h4v10.5h-17zM12 11.5a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z",
} as const;

/** Route with a road surface, a glowing trail, icon pins, and a car that drives the route. Decorative only. */
function RouteArt() {
  return (
    <svg viewBox="0 0 1440 400" preserveAspectRatio="xMidYMax slice" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 w-full" aria-hidden="true">
      <defs>
        <filter id="route-glow" x="-10%" y="-50%" width="120%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <path id="main-route" d={MAIN_ROUTE} fill="none" />

      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {SIDE_ROADS.map((d) => (
          <path key={d} d={d} stroke="#334155" strokeWidth="8" strokeOpacity="0.8" />
        ))}
        <path d={MAIN_ROUTE} stroke="#38bdf8" strokeWidth="26" strokeOpacity="0.45" filter="url(#route-glow)" />
        <path d={MAIN_ROUTE} stroke="#1e293b" strokeWidth="14" />
        <path d={MAIN_ROUTE} stroke="#f8fafc" strokeWidth="2.5" strokeDasharray="14 14" strokeOpacity="0.85" />
      </g>

      <Pin x={60} y={300} color="#0ea5e9" glyph="sight" />
      <Pin x={420} y={200} color="#ef4444" glyph="food" />
      <Pin x={740} y={240} color="#14b8a6" glyph="sight" />
      <Pin x={880} y={280} color="#10b981" glyph="food" />
      <Pin x={1140} y={180} color="#f59e0b" glyph="hotel" />
      <Pin x={1300} y={120} color="#8b5cf6" glyph="hotel" />

      <g className="motion-reduce:hidden">
        <g>
          <rect x="-15" y="-8" width="30" height="15" rx="5" fill="#fbbf24" stroke="#ffffff" strokeWidth="1.5" />
          <rect x="-7" y="-5" width="10" height="5" rx="1.5" fill="#0f172a" fillOpacity="0.55" />
          <circle cx="-9" cy="8" r="3.5" fill="#0f172a" />
          <circle cx="9" cy="8" r="3.5" fill="#0f172a" />
        </g>
        <animateMotion dur="18s" repeatCount="indefinite" rotate="auto">
          <mpath href="#main-route" />
        </animateMotion>
      </g>
    </svg>
  );
}

function Pin({ x, y, color, glyph }: { x: number; y: number; color: string; glyph: keyof typeof STOP_GLYPHS }) {
  return (
    <g>
      <circle cx={x} cy={y} r="22" fill={color} fillOpacity="0.25" />
      <circle cx={x} cy={y} r="15" fill={color} stroke="#ffffff" strokeWidth="3" />
      <g transform={`translate(${x - 12} ${y - 12})`} fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={STOP_GLYPHS[glyph]} />
      </g>
    </g>
  );
}

/** A static example of the itinerary view. It shows the layout only and uses no real trip data. */
const EXAMPLE_STOPS = [
  { time: "08:00", name: "Austin", detail: "Start", dot: "bg-sky-400" },
  { time: "11:30", name: "Lubbock", detail: "Lunch stop", dot: "bg-amber-400" },
  { time: "16:00", name: "Amarillo", detail: "Overnight at a hotel", dot: "bg-violet-400" },
];

function ExampleItinerary() {
  return (
    <div className="mt-8 max-w-lg rounded-2xl border border-white/25 bg-slate-950/45 p-6 text-white shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold">Day 1 · Austin to Amarillo</p>
        <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-xs font-medium">Example</span>
      </div>
      <ol className="mt-5 space-y-4">
        {EXAMPLE_STOPS.map((stop) => (
          <li key={stop.name} className="flex items-center gap-3 text-base">
            <span className="w-14 shrink-0 text-sm text-white/80">{stop.time}</span>
            <span className={`h-3 w-3 shrink-0 rounded-full ${stop.dot}`} aria-hidden="true" />
            <span className="font-semibold">{stop.name}</span>
            <span className="text-sm text-white/80">{stop.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-900 bg-[url('/images/road-trip-glacier.jpg')] bg-cover bg-center">
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-900/65 to-transparent" aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-slate-950/60 to-transparent" aria-hidden="true" />
      <RouteArt />

      <header className="absolute left-6 top-6 z-10 flex items-center gap-2 lg:left-8">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500 text-white shadow-lg" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z" />
          </svg>
        </span>
        <span className="font-semibold text-white drop-shadow">My Road Trip Planner</span>
      </header>

      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-12 px-6 pb-16 pt-24 lg:grid-cols-[1.1fr_24rem] lg:py-16">
        <section className="max-w-xl">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white drop-shadow-lg sm:text-5xl">
            Plan your road trip, one stop at a time
          </h1>
          <p className="mt-5 text-lg leading-8 text-white drop-shadow-md sm:text-xl">
            Build a day-by-day route with driving time, overnight stops and places worth a detour. Your assistant suggests changes, and nothing changes until you accept.
          </p>
          <ul className="mt-6 space-y-3 text-base font-medium text-white drop-shadow">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <ExampleItinerary />
        </section>

        <section aria-label="Sign in or create an account" className="order-first w-full max-w-sm justify-self-center rounded-2xl bg-white p-8 shadow-2xl lg:order-none lg:w-96 lg:justify-self-end">
          <h2 className="text-xl font-semibold text-slate-900">Get started</h2>
          <p className="mt-1 text-sm text-slate-600">Sign in to your trips, or create an account.</p>
          <AuthForm />
        </section>
      </div>
    </main>
  );
}
