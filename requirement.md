# RoadTrip AI --- Product Requirements and Devin Build Instructions

**Document:** `requirement.md`\
**Product type:** Responsive web application\
**Version:** 1.0\
**Status:** Initial build specification

------------------------------------------------------------------------

# Part 1 --- Product requirements

## 1. Product vision

Build an AI-powered, interactive road trip planning application. Users
can enter a starting location and destination, provide intermediate
stops, upload a list of stops, or describe their travel plans through a
conversational chat interface.

The application combines route planning, points-of-interest discovery,
personalized recommendations, visual map exploration, and an editable
day-by-day itinerary. The itinerary and map must stay synchronized as
the user changes preferences or requests modifications through chat or
direct editing.

The product should feel like a travel-planning workspace: a map is the
primary visual surface, a chat assistant helps the user plan, and a
structured itinerary provides an actionable and downloadable trip plan.

## 2. Goals and success criteria

### Primary goals

1.  Create a driving route between a user-provided origin and
    destination.
2.  Support optional intermediate stops, including uploaded stop lists.
3.  Recommend relevant attractions, scenic detours, restaurants,
    accommodations, parks, and other points of interest along or near
    the route.
4.  Adapt recommendations to trip duration, driving-distance tolerance,
    interests, travel party, pace, budget, and other preferences.
5.  Display the route, stops, and recommendations on an interactive map
    with useful photos and descriptions.
6.  Support natural-language conversations that can create, explain, and
    modify the trip plan.
7.  Maintain a structured itinerary that updates whenever the route or
    recommendations change.
8.  Export the itinerary in useful formats.

### Success criteria

-   A user can create a basic route without using chat.
-   A user can create or modify a route using natural language.
-   Map markers and itinerary entries remain synchronized.
-   Route and travel-time calculations come from a routing service, not
    AI-generated estimates.
-   The app clearly distinguishes verified information from estimates or
    unavailable information.
-   A user can save, reopen, edit, and export a trip.

## 3. Target users and typical workflows

### Workflow A: Simple point-to-point trip

1.  User enters origin, destination, and travel dates or total trip
    duration.
2.  User selects preferences, such as scenic drives, nature, museums,
    food, or family-friendly activities.
3.  App calculates a primary route.
4.  AI suggests relevant stops and attractions.
5.  User reviews suggestions on the map and in the itinerary.
6.  User accepts, rejects, or modifies suggestions.
7.  App updates the route and itinerary.

### Workflow B: Trip with user-specified stops

1.  User enters origin and destination.
2.  User adds intermediate stops manually or uploads a file.
3.  App validates and geocodes each stop.
4.  User chooses whether the entered stop order must be preserved or may
    be optimized.
5.  App calculates the route and identifies optional attractions between
    stops.
6.  User modifies the plan through chat or direct editing.

### Workflow C: Conversational planning

Example conversation: - User: "Plan a seven-day road trip from Austin to
Denver. I enjoy national parks, scenic drives, and interesting small
towns." - Assistant: asks only essential follow-up questions, such as
travel dates or desired daily driving limits. - Assistant: proposes a
route and a day-by-day itinerary. - User: "I don't want to drive more
than five hours on most days." - Assistant: adjusts overnight stops and
the itinerary. - User: "Add a scenic stop near Santa Fe and remove the
museum." - Assistant: updates the route, map markers, and itinerary,
explaining any meaningful changes.

The assistant must not silently discard user-entered required stops or
constraints.

## 4. Core application layout

Use a responsive three-area workspace on desktop:

-   **Map area:** largest area, showing the route and selected markers.
-   **Chat panel:** conversational assistant, preferably docked on the
    right or in a collapsible panel.
-   **Itinerary panel:** day-by-day list or table, preferably on the
    left or below the map depending on screen size.

On mobile, use a tabbed or stacked layout for Map, Chat, and Itinerary.
Do not attempt to squeeze all three desktop panels into a narrow screen.

Provide a top-level trip header with trip name, origin/destination,
dates or duration, save status, and export actions.

## 5. Functional requirements

### 5.1 Trip creation and input

Support: - Origin and destination text inputs with place autocomplete. -
Optional departure date, return date, or total trip duration. - Optional
intermediate stops. - Manual addition, deletion, and reordering of
stops. - An option to preserve the user's stop order or optimize it. - A
trip name and optional notes. - A clear distinction between required
stops and AI-suggested stops.

Input validation: - Resolve ambiguous place names by asking the user to
select a result. - Show unresolved or invalid locations and allow
correction. - Do not silently replace an unresolved location with a
different place. - Confirm the selected locations before calculating the
route.

### 5.2 Stop-list upload

Support CSV and XLSX uploads for user-provided stop lists.

Expected input columns may include: - Stop name - Address or
city/state - Optional latitude and longitude - Optional notes - Optional
preferred order or sequence number - Optional required/optional
indicator

Requirements: - Provide a sample downloadable CSV template. - Show a
preview before importing. - Let users map uploaded columns to
application fields if headers differ. - Validate rows and identify
missing or ambiguous locations. - Report row-level errors and allow
users to correct or skip invalid rows. - Preserve the original uploaded
stop order unless the user explicitly requests optimization. - Never
treat an uploaded file as executable content.

### 5.3 Route calculation

Use a real routing provider for driving routes and route metrics.

Requirements: - Calculate route geometry, total distance, estimated
driving time, and leg-by-leg metrics. - Support multiple waypoints and
provider waypoint limits. - If a route has too many stops for one
request, split the routing operation into valid legs and combine the
results. - Show the route as a line on the map. - Show each route leg's
distance and estimated driving time. - Recalculate affected legs when
stops are added, removed, or reordered. - Support alternate routes when
the provider offers them. - Clearly label driving time as an estimate
and avoid implying it includes breaks, traffic, or stops unless the
provider explicitly accounts for them. - Do not let the AI invent road
geometry, distances, driving times, road closures, or turn-by-turn
directions.

Routing preferences should include: - Fastest route - Shortest route,
when supported - Scenic route, only when the provider or a documented
routing method supports it - Avoid tolls, highways, or ferries, when
supported - Maximum preferred driving time per day - Maximum preferred
driving distance per day

If a requested routing preference is unsupported, explain the limitation
and offer the closest supported alternative.

### 5.4 Points of interest (POIs)

Discover attractions and useful places along or near the route.

Potential categories: - National and state parks - Scenic viewpoints and
drives - Hiking and outdoor activities - Museums and historical sites -
Small towns and local landmarks - Restaurants and cafes - Hotels and
campgrounds - Family-friendly activities - Shopping and local
experiences - Rest areas and practical travel stops

Recommendation logic: - Consider route proximity and reasonable detour
time. - Consider trip duration and available time each day. - Match the
user's interests, budget, pace, and travel party. - Avoid recommending
too many stops for a day. - Distinguish must-see recommendations from
optional suggestions. - Explain why each recommendation is relevant. -
Show the estimated detour distance/time where available. - Allow users
to filter by category and preference. - Allow a user to add a
recommendation to the itinerary, dismiss it, or save it for later.

Do not claim a business or attraction is open at a particular time
unless current hours have been retrieved from a reliable source. Display
the source or last-checked time where practical.

### 5.5 Map visualization

Use an established interactive map SDK.

Map requirements: - Show the full route with a clear line. - Use
distinct marker styles for origin, destination, required stops,
overnight stops, and optional POIs. - Number ordered stops where
helpful. - Provide marker clustering when many locations are close
together. - Fit the map to the route by default and allow zoom/pan. -
Clicking a marker opens a detail card or side panel. - Clicking an
itinerary entry highlights the corresponding map marker and route
segment. - Clicking a map marker highlights its itinerary entry, if one
exists. - Support map layers or styles only if they materially improve
usability. - Include a legend and accessible marker labels. - Keep the
map and itinerary synchronized after every accepted change.

A POI detail card should support: - Name and category - Short
description - Photos or other media, where available and properly
licensed - Address/location - Distance or detour from route - Estimated
visit duration, clearly identified as an estimate - Source link - Add to
trip / remove from trip action

### 5.6 Photos and media

Use image services or provider-supplied media where permitted.

Requirements: - Show relevant photos for attractions and destinations. -
Associate each image with its source and attribution where required. -
Respect provider licensing, attribution, caching, and display
requirements. - Do not scrape images from arbitrary websites. - Do not
fabricate photos or imply a generic image depicts a specific
attraction. - If a verified image is unavailable, show a neutral
placeholder and retain the location information. - Support links to
official attraction or tourism websites. - Lazy-load images and provide
responsive image sizing.

Optional future enhancement: support short videos, embedded official
media, and user-uploaded trip photos.

### 5.7 AI chat assistant

The chat assistant is a central feature, not a separate FAQ bot.

It should: - Understand natural-language travel requests and
preferences. - Ask concise clarifying questions when essential
information is missing. - Summarize its understanding of the trip. -
Recommend routes, stops, and activities based on available data. -
Explain trade-offs, such as a scenic detour adding driving time. -
Modify the route or itinerary when the user requests a change. - Support
requests such as "make day two less busy," "add a national park," "avoid
toll roads," "find a lunch stop halfway," or "keep the drive under four
hours." - Maintain trip context throughout the conversation. -
Distinguish suggestions from confirmed changes. - Ask for confirmation
before destructive or materially disruptive changes, such as removing a
required stop or replacing the entire route. - Explain when a request
cannot be satisfied due to provider limitations or time constraints.

The AI must use application tools/functions to retrieve locations,
calculate routes, discover POIs, and update the itinerary. It must not
pretend to have performed an action when the underlying service call
failed.

### 5.8 Structured trip plan and itinerary

Provide both day-by-day cards and a compact table/list view.

Each itinerary item should support: - Day number and date, if dates are
supplied - Sequence/order - Location or activity name - Category -
Address or coordinates - Arrival time, if planned - Estimated visit
duration - Driving distance from previous stop - Estimated driving time
from previous stop - Suggested departure time, if calculated -
Description and notes - Photo/media thumbnail - Required or optional
status - Source/reference link

Each day should show: - Start and end locations - Total driving
distance - Total estimated driving time - Estimated activity/visit
time - Overnight location, if applicable - Warnings when the schedule
appears too ambitious

Do not create false precision in arrival times. If traffic, opening
hours, or visit durations are unknown, label the schedule as
provisional.

Allow users to: - Edit notes and visit durations. - Reorder stops using
drag-and-drop or accessible move controls. - Add or remove itinerary
entries. - Mark items as required, optional, or completed. - Regenerate
suggestions for a specific day without rebuilding the entire trip. -
Undo or revert recent changes where feasible.

### 5.9 Dynamic updates and state consistency

The map, route, chat context, and itinerary must share a consistent trip
data model.

When a user accepts a change: 1. Validate the requested change. 2.
Update the trip data model. 3. Recalculate affected route legs through
the routing service. 4. Refresh affected POI recommendations when
needed. 5. Update map geometry and markers. 6. Update itinerary order,
distances, and time estimates. 7. Add a concise explanation to the chat
history. 8. Save the updated trip.

Use explicit proposed changes for complex modifications. The user should
be able to review and accept or reject a proposed change.

Maintain an audit/history trail for meaningful trip edits, with undo
support where feasible.

### 5.10 Saving, loading, and exporting

Users should be able to save a trip and reopen it later.

For the initial version: - Support authenticated accounts or a clearly
documented guest-trip approach. - Persist trips, stops, preferences,
chat history as appropriate, and itinerary entries. - Provide clear
privacy controls and a way to delete a trip. - Avoid storing API keys or
secrets in client-side code.

Export formats: - PDF: polished, printable itinerary with day-by-day
plan, route summary, selected photos, and useful links. - CSV:
structured stop and itinerary data. - XLSX: formatted itinerary table,
if practical. - JSON: optional machine-readable backup.

The export should reflect the latest saved itinerary and include a
generated timestamp. Provide a download action and meaningful filenames.

### 5.11 Preferences

Capture preferences through chat and optional settings: - Interests and
activity categories - Trip pace: relaxed, balanced, or packed - Maximum
driving time/distance per day - Budget range - Travel party: solo,
adults, children, or mixed group - Accessibility or mobility
considerations, if volunteered - Accommodation preferences - Food
preferences - Scenic versus fastest route - Tolls, highways, ferries,
and other route restrictions - Must-visit and must-avoid locations

Allow preferences to be edited at any time. Do not infer sensitive
personal characteristics.

## 6. Non-functional requirements

### Performance

-   Load the main application quickly.
-   Use loading indicators for geocoding, routing, POI search, and AI
    responses.
-   Avoid blocking the entire UI during a slow operation.
-   Debounce autocomplete and search requests.
-   Cache provider responses where provider terms permit.
-   Use pagination or progressive loading for large POI sets.

### Reliability

-   Handle provider timeouts, rate limits, invalid responses, and
    network failures.
-   Provide retry actions and useful error messages.
-   Preserve user edits if a request fails.
-   Avoid duplicate itinerary entries after retries.
-   Use stable IDs for stops and POIs rather than relying on array
    positions.

### Security and privacy

-   Keep API secrets on the server.
-   Validate and sanitize user input and uploaded files.
-   Enforce upload size and file-type limits.
-   Protect authenticated trip data with appropriate authorization
    checks.
-   Do not expose one user's private trips to another user.
-   Use secure transport and follow standard web security practices.
-   Make clear what chat history and trip information are stored.
-   Do not send unnecessary personal information to third-party AI or
    map providers.

### Accessibility

-   Use semantic controls, keyboard navigation, visible focus states,
    and sufficient contrast.
-   Provide text alternatives for meaningful images.
-   Do not rely on marker color alone to convey stop type.
-   Ensure itinerary editing is usable without drag-and-drop.

## 7. Suggested technical architecture

Devin may recommend alternatives, but must document the trade-offs and
avoid unnecessary complexity.

### Frontend

-   TypeScript
-   React with Next.js
-   Responsive component system
-   Interactive map SDK, such as Mapbox or Google Maps
-   State management suitable for a shared trip model
-   Accessible chat and itinerary components

### Backend

-   Next.js server routes or a separate API service
-   TypeScript preferred for shared data models
-   REST or typed API endpoints
-   Server-side orchestration for AI tool calls and external providers

### Data storage

-   PostgreSQL
-   Prisma or a comparable ORM
-   Optional PostGIS if spatial queries justify it
-   Object storage only if user-uploaded media is added

### External services --- provider abstraction required

Implement interfaces so providers can be changed without rewriting
business logic.

-   **Maps and geocoding:** Google Maps Platform, Mapbox, or another
    suitable provider.
-   **Routing:** a provider with driving directions, waypoint support,
    route geometry, and route options.
-   **Places/POIs:** provider places search, tourism data, or another
    licensed source.
-   **Images:** provider-approved place photos or licensed image
    sources.
-   **LLM:** configurable provider through server-side environment
    variables.

Devin should compare provider costs, free-tier limits, attribution
rules, waypoint limits, and commercial-use restrictions before selecting
services. Do not assume a free tier is permanent.

### Provider interfaces

At minimum, define service interfaces for: - `GeocodingService` -
`RoutingService` - `PlacesService` - `ImageService` - `AITripAssistant`

Use mock implementations for local development and automated tests. The
app should explain when mock data is being used.

## 8. Suggested data model

Design a normalized schema. The following entities are a starting point,
not a rigid mandate.

### User

-   id
-   email/auth provider identifier
-   createdAt

### Trip

-   id
-   userId or guest session identifier
-   name
-   origin location
-   destination location
-   startDate
-   endDate
-   durationDays
-   preferences JSON
-   routingOptions JSON
-   status
-   createdAt
-   updatedAt

### Stop

-   id
-   tripId
-   name
-   address
-   latitude
-   longitude
-   sequence
-   stopType: origin, destination, required, overnight, optional
-   source: user, upload, AI
-   notes
-   estimatedVisitMinutes
-   status

### RouteLeg

-   id
-   tripId
-   fromStopId
-   toStopId
-   distanceMeters
-   durationSeconds
-   geometry
-   provider
-   calculatedAt

### PlaceRecommendation

-   id
-   tripId
-   name
-   category
-   description
-   address
-   latitude
-   longitude
-   source
-   sourceUrl
-   image metadata
-   estimatedVisitMinutes
-   detourDistanceMeters
-   detourDurationSeconds
-   status: suggested, accepted, dismissed

### ItineraryDay

-   id
-   tripId
-   dayNumber
-   date
-   overnightStopId
-   notes

### ItineraryItem

-   id
-   itineraryDayId
-   stopId or recommendationId
-   sequence
-   plannedStartTime
-   visitDurationMinutes
-   notes
-   requiredStatus

### ChatMessage

-   id
-   tripId
-   role
-   content
-   createdAt
-   optional tool/action metadata

### TripRevision

-   id
-   tripId
-   revisionNumber
-   change summary
-   snapshot or change set
-   createdAt

Store coordinates as numeric latitude/longitude values with validation.
Store provider-specific raw data only when necessary and permitted.

## 9. API and application operations

Define clear server-side operations, such as: - Create trip - Get trip -
Update trip preferences - Geocode location - Import and validate stop
file - Calculate route - Search POIs along route - Propose itinerary -
Apply proposed trip change - Add/remove/reorder stop - Recalculate
affected route legs - Save trip revision - Export PDF/CSV/XLSX/JSON -
Delete trip

AI tool calls must invoke these application operations rather than
directly modifying arbitrary database records.

## 10. MVP scope and later enhancements

### MVP --- required for first usable release

1.  Responsive web application.
2.  Origin/destination input and manual intermediate stops.
3.  CSV/XLSX stop-list upload with preview and validation.
4.  Interactive driving route map.
5.  POI discovery along or near the route.
6.  Basic photos and source links for recommendations.
7.  AI chat for trip creation and itinerary modifications.
8.  Day-by-day itinerary with distance and time estimates.
9.  Synchronized map and itinerary.
10. Save/reopen trips.
11. PDF and CSV export.
12. Error handling, basic automated tests, and setup documentation.

### Phase 2

-   User accounts and trip library improvements.
-   XLSX export and JSON backup.
-   More sophisticated daily schedule optimization.
-   Alternate route comparisons.
-   Accommodation and restaurant discovery enhancements.
-   Better image and media coverage.
-   Trip collaboration and sharing.
-   Mobile-specific refinements.

### Phase 3

-   Live traffic and weather-aware adjustments, subject to provider
    availability.
-   Offline itinerary access.
-   Calendar integration.
-   Booking links and reservation integrations.
-   User-uploaded trip photos and shared trip albums.
-   Voice input and multilingual support.

Do not let Phase 2 or Phase 3 features delay a stable MVP.

## 11. Acceptance tests

The MVP is not complete until the following scenarios work:

1.  Create a trip with an origin and destination and display a valid
    driving route.
2.  Add three manual intermediate stops and show them in the correct
    order.
3.  Upload a CSV containing valid, invalid, and ambiguous stops; preview
    and report each row correctly.
4.  Preserve uploaded stop order unless the user explicitly chooses
    optimization.
5.  Search for relevant POIs along the route and show results with
    grounded descriptions and source links.
6.  Add a POI from the map to the itinerary and verify that the route
    and itinerary update.
7.  Remove an optional stop and verify that affected route legs
    recalculate.
8.  Ask the AI to reduce daily driving time and verify that it proposes
    a revised itinerary using actual routing metrics.
9.  Ask the AI to remove a required stop and verify that it requests
    confirmation before doing so.
10. Click an itinerary item and verify that its map marker is
    highlighted; click a marker and verify the reverse relationship.
11. Save a trip, reload the application, and reopen the same trip with
    its current state.
12. Export a PDF and CSV and verify that they contain the latest
    itinerary.
13. Simulate an external provider failure and verify that the
    application displays an actionable error without losing edits.
14. Verify that API keys are not exposed in browser-delivered code.
15. Verify that one user cannot access another user's private trip.

## 12. Required delivery

Deliver: - Complete working source code. - `requirement.md` included in
the repository. - `README.md` with setup, architecture, and operating
instructions. - `.env.example` listing required environment variables
without real secrets. - Database schema and migration instructions. -
Provider setup instructions and links to relevant developer portals. -
Seed/demo trip data. - Automated tests for critical workflows. - A clear
list of implemented, partially implemented, and deferred requirements. -
Deployment instructions.

The application must run locally from a clean checkout using the
documented steps.

