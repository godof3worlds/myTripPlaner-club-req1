# TripWise Application Documentation

TripWise is a full-stack travel discovery and itinerary planner. Visitors can browse destinations with current weather and destination photography; signed-in users can save places to a personal itinerary.

## Contents

- [How the application works](#how-the-application-works)
- [Technology stack](#technology-stack)
- [External APIs and services](#external-apis-and-services)
- [Backend API](#backend-api)
- [Authentication and data storage](#authentication-and-data-storage)
- [Run locally](#run-locally)
- [Project layout](#project-layout)
- [Current implementation notes](#current-implementation-notes)

## How the application works

### Explore destinations

1. The browser loads the static interface from the `public/` directory.
2. The frontend requests `GET /api/destinations`.
3. The server starts with its curated destination list. When a search term is supplied and an OpenTripMap key is configured, it also attempts a geocoding and nearby-place lookup.
4. The server enriches each result with current weather from Open-Meteo and a destination image from Wikimedia Commons. These independent requests are made concurrently.
5. The server returns the destination data as JSON. The browser renders the cards, including category, rating, location, weather and image attribution where available.
6. If an external image lookup fails or has no suitable result, the curated image on the destination record remains in use. If a weather lookup fails, the UI reports weather as unavailable rather than inventing a forecast.

Search is debounced in the browser. The server applies search, category and rating filters, then sorts the results by rating, name or current temperature. The curated list contains 12 destinations. When OpenTripMap is configured, a matching search can add up to 24 nearby places to the same card grid. The page initially shows 12 results; **Show more destinations** reveals the next 12 until all matches are visible.

On wide screens, faint travel-wheel artwork sits behind the page content at both edges and rotates in opposite directions in response to scrolling. The decoration is hidden on narrower screens and remains static when reduced motion is preferred.

### View destination details

Selecting a card or its **Details** button opens a modal with the destination description, image, rating and weather details. The modal also provides a planned-date field and notes field for adding the destination to an itinerary.

### Save and manage an itinerary

Selecting an itinerary card opens its saved destination details, planned date and notes. The itinerary chat lets an authenticated user select one of their saved places and ask the OpenRouter chat model questions about it. A message asking for a poster/image routes to NVIDIA NIM; the returned image is displayed in the chat and can be downloaded. Chat history and generated poster images are held in the browser only and are not persisted.

Itinerary access requires an authenticated account. After sign-in, the browser sends the session token as a Bearer token in the `Authorization` header. The server associates each itinerary record with the authenticated user. Users can view their saved destinations, add destinations, remove them and clear their itinerary. The interface displays an item counter and trip summary.

### Authentication

Registration and login are handled by the Express server. Passwords are hashed using Node's built-in `crypto.scryptSync` with a per-password random salt. Successful sign-in creates a random in-memory session token that expires after seven days. Logging out removes the token.

## Technology stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | Node.js | Runs the server and test runner |
| HTTP server | Express 4 | Serves static frontend files and the JSON API |
| Frontend | HTML5, CSS3, vanilla JavaScript | Responsive interface, browser state and API calls |
| Database | Supabase PostgreSQL | The application's only database for user and itinerary data |
| Authentication | Node `crypto` and in-memory sessions | Salted scrypt password hashes and Bearer-token sessions |
| Tests | `node:test` and `node:assert` | Runs the project's automated tests |

The npm dependencies are Express and `@supabase/supabase-js`. Cryptography, HTTP fetch, and the test runner use Node.js built-ins.

## External APIs and services

### Open-Meteo — current weather

- Website: [open-meteo.com](https://open-meteo.com/)
- Used by: `GET /api/destinations` and `GET /api/destinations/:id`
- Key required: No
- Data requested: Current temperature, apparent temperature, relative humidity, weather code and wind speed.
- Caching: Successful weather results are cached in server memory for 10 minutes.
- Failure behavior: The server logs the failure and returns `weather: null`; the card and modal show an unavailable state.

### Wikimedia Commons — destination images

- API: [commons.wikimedia.org/w/api.php](https://commons.wikimedia.org/w/api.php)
- Used by: `GET /api/destinations` and `GET /api/destinations/:id`
- Key required: No
- Data requested: Search results for Commons file pages, thumbnail URLs and file metadata for attribution and license.
- Caching: Successful image lookups are cached in server memory for 24 hours. Failed lookups are briefly cached to avoid repeatedly calling a rate-limited service.
- Attribution: When Commons supplies a suitable result, the card displays the creator and license (when available) and links to the Commons file page.
- Failure behavior: The destination's curated image remains in use.

Commons files have their own reuse terms. Follow the license shown on each linked file page when reusing an image outside the application.

### OpenTripMap — optional places search

- Website: [opentripmap.io](https://opentripmap.io/)
- Used by: `GET /api/destinations?q=...`, only if `OPENTRIPMAP_API_KEY` is configured.
- Key required: Yes
- Behavior: The server looks up a queried place name, then requests up to 24 nearby interesting places. Returned places are combined with the curated destinations before filtering. The UI progressively reveals those results in batches of 12.
- Failure behavior: The curated destination list is still returned if the external lookup fails or produces no results.

### OpenRouter — itinerary AI chat

- Website: [openrouter.ai](https://openrouter.ai/)
- Used by: authenticated `POST /api/ai/chat` for text messages.
- Key required: Yes; set `OPENROUTER_API_KEY` on the server. The key is never sent to the browser.
- Text model: `OPENROUTER_CHAT_MODEL` (default `openai/gpt-4o-mini`).
- The server verifies that the selected destination belongs to the signed-in user's Supabase itinerary before sending its context to OpenRouter.

### NVIDIA NIM — itinerary poster generation

- Keys: create an API key in the [NVIDIA API Catalog](https://build.nvidia.com/) and store it as `NVIDIA_API_KEY_for_Posters` on the server. Never put it in browser code or chat.
- Model: [NVIDIA Qwen-Image](https://build.nvidia.com/qwen/qwen-image), a text-to-image model with poster text rendering.
- Used by: authenticated `POST /api/ai/chat` when the user asks for a poster or image.
- Image model: NVIDIA NIM `qwen/qwen-image` hosted inference.
- The server sends a destination-specific prompt to `https://ai.api.nvidia.com/v1/genai/qwen/qwen-image` using a bearer token, requesting the model's 2:3 portrait aspect ratio (1056×1584). It accepts PNG, JPEG or WebP base64 output up to 15 MB.
- Hosted model access depends on NVIDIA account/API availability. A 404 is reported as a model-access issue; confirm hosted inference is enabled for this model in NVIDIA Build.
- The poster is returned to the browser as a downloadable image and is not stored in Supabase. API access is subject to NVIDIA account limits and model availability.

### Supabase — application database

- Website: [supabase.com](https://supabase.com/)
- Used when both `SUPABASE_URL` and `SUPABASE_KEY` are present.
- Stores user and itinerary records in PostgreSQL. Supabase credentials are required for registration, login and itinerary operations.
- Existing Supabase installations need the ownership column described in `supabase_schema.sql`.

### Geoapify — not currently called by the application

Geoapify is mentioned in the repository's existing project overview, but the current server implementation does not make Geoapify requests. A `GEOAPIFY_API_KEY` value alone does not enable Geoapify functionality.

## Backend API

All endpoints return JSON unless otherwise indicated. The itinerary routes require a valid signed-in session; unauthenticated requests receive `401 Unauthorized`.

| Method | Path | Authentication | Description |
|---|---|---|---|
| `GET` | `/api/config` | No | Reports server and configured service status. |
| `GET` | `/api/destinations` | No | Returns destinations with weather and image data. Supports `q`, `category`, `minRating` and `sortBy` query parameters. |
| `GET` | `/api/destinations/:id` | No | Returns details for one curated destination, including current weather and image metadata. |
| `POST` | `/api/auth/register` | No | Creates an account and starts a session. |
| `POST` | `/api/auth/login` | No | Verifies credentials and starts a session. |
| `GET` | `/api/auth/me` | No | Returns the current session's user, if signed in. |
| `POST` | `/api/auth/logout` | No | Invalidates the current Bearer-token session. |
| `POST` | `/api/ai/chat` | Yes | Chats about an itinerary destination or generates a poster when requested. Requires OpenRouter for text chat and NVIDIA NIM for posters. |
| `GET` | `/api/itinerary` | Yes | Returns the signed-in user's saved itinerary. |
| `POST` | `/api/itinerary` | Yes | Adds a destination to the signed-in user's itinerary. |
| `DELETE` | `/api/itinerary/:id` | Yes | Removes an itinerary entry belonging to the signed-in user. |
| `POST` | `/api/itinerary/zero` | Yes | Removes all itinerary entries belonging to the signed-in user. |

### Destination query parameters

- `q`: Text search across place name, city, country, category, description and tags. Also triggers the optional OpenTripMap lookup (up to 24 nearby places) when its key is set.
- `category`: Category filter such as `Landmark`, `Culture`, `Nature`, `Beach` or `Adventure`.
- `minRating`: Minimum rating.
- `sortBy`: `rating` (default), `name-asc`, `name-desc`, `temp-desc` or `temp-asc`.

Successful destination responses use the shape `{ "success": true, "count": 0, "data": [] }`. A destination may include `weather: null` when weather is unavailable. Image results can include `image_credit` and `image_credit_url`; if there is no Commons result, the original curated image fields are retained.

### Authentication headers

For authenticated requests, include the session token returned by login in the `Authorization` header using the `Bearer` scheme. The frontend stores the session token in browser local storage and adds this header to itinerary requests.

## Authentication and data storage

Supabase contains `public.users` and `public.itinerary` tables. The itinerary table includes a `user_id` ownership field so reads and removals are scoped to the signed-in user. Use `supabase_schema.sql` to create or update the required tables and ownership column.

Database writes are read back from Supabase to verify successful writes; deletion and clear operations also verify that the targeted user's records are gone. If Supabase is not configured, public destination browsing remains available, while account and itinerary requests return a service-unavailable response.

Session tokens are held in process memory, not persisted to the database. Restarting the server clears active sessions, so users need to sign in again.

## Run locally

Use a Node.js version that supports the project's `--env-file-if-exists` option.

```powershell
npm install
npm test
npm start
```

Then open [http://localhost:3000](http://localhost:3000). To change the port or configure optional integrations, create a local `.env` file:

```env
PORT=3000
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_api_key
OPENTRIPMAP_API_KEY=your_opentripmap_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_CHAT_MODEL=openai/gpt-4o-mini
APP_URL=http://localhost:3000
NVIDIA_API_KEY_for_Posters=your_nvidia_api_key
```

Keep real credentials private; do not commit them. Supabase URL and key are required for account and itinerary features. OpenRouter credentials enable text chat; NVIDIA credentials enable image generation. Open-Meteo and Wikimedia Commons do not require API keys.

## Project layout

```text
server.js                 Express server, authentication, database access and external API calls
public/
  index.html              Page structure and destination/itinerary interface
  app.js                  Browser state, API requests, card rendering and interactions
  styles.css              Responsive design and visual components
  tripwise-logo.png       Brand logo used in the header, auth modal and browser icon
  travel-wheel.png        Travel-wheel artwork used as the subtle scroll-driven background
  plane-cursor.svg        Airplane-shaped cursor for mouse and trackpad pointers
test.js                   Automated tests using Node's test runner
package.json              Dependencies and start/test scripts
supabase_schema.sql       Supabase database schema
```

## Current implementation notes

- Search, sort, weather and destination image lookups run through the server; external API credentials are not required in browser code.
- Weather and image caches are in memory and are cleared when the server restarts.
- OpenTripMap is only queried when a non-empty search term and API key are both present.
- `GEOAPIFY_API_KEY` is not currently consumed by `server.js`.
- The current server implements itinerary add, list, delete and clear operations. There is no itinerary `PATCH` or `PUT` endpoint in the current implementation.
- The UI contains promotional “AI Trip Planner” text, but this version does not call an AI service or generate AI itineraries.
