# TripWise - Smart Travel Planner
**Track 3: Full-Stack Development**  
*AWS Student Builder Group, VIT Chennai Recruitment Task*

TripWise is a travel-planning application that allows travelers to explore global destinations, query live weather conditions in real-time, inspect rich location details, and build a personalized itinerary persisted securely in a database.

---

## 🚀 Key Features

For a detailed guide to the application flow, architecture, integrations, and API routes, see [APP_DOCUMENTATION.md](./APP_DOCUMENTATION.md).

1. **Destination Discovery & External APIs**:
   - Integrates **Open-Meteo API** to fetch live real-time temperatures, apparent temperatures, conditions, and wind speed for every location without requiring an API key.
   - Each destination card shows the current temperature and weather condition; if Open-Meteo is unreachable, the card reports that weather is unavailable instead of showing placeholder conditions.
   - Retrieves destination photos from the public **Wikimedia Commons API**, displays attribution on the card, and retains the curated image if no Commons image is available.
   - Supports optional **OpenTripMap** place search via `.env`; Geoapify is listed as a possible integration but is not called by the current implementation.
2. **Search, Filtering, and Sorting**:
   - Live debounced search across destination names, cities, countries, descriptions, and tags.
   - Place searches can add up to 24 nearby results from OpenTripMap; the responsive card grid fits more destinations on desktop screens.
   - Larger result sets reveal 12 cards at a time with a **Show more destinations** control.
   - Categorical filtering: *Landmark, Culture, Nature, Beach, Adventure*.
   - Multi-option sorting: *Top Rated, Name (A-Z), Name (Z-A), Warmest Weather, Coolest Weather*.
3. **Destination Details & Forecast**:
   - Interactive modal displaying high-resolution media, ratings, full description, and a real-time weather widget.
   - Quick date picker and custom notes field to add directly to the itinerary.
4. **Itinerary Management & Persistence**:
   - Add, view, and remove destinations from your trip; clear all of your saved itinerary entries when needed.
   - Click a saved itinerary card to review its details, planned date and notes.
   - Chat with an OpenRouter-powered trip assistant about a selected saved place, or ask it to generate a downloadable AI travel poster.
   - Itinerary access requires sign-in and all records are scoped to the signed-in account.
   - Persisted in **Supabase PostgreSQL**; Supabase credentials are required for account and itinerary features.
   - Dynamic itinerary badge counter and live summary statistics (total destinations, unique countries).
5. **State Feedback & Responsive Design**:
   - Instant loading animations, empty search states with quick-reset CTA, empty itinerary illustration, error fallback banners with retry actions, and transient toast feedback.
   - Responsive layout adapting to mobile and desktop screens, with subtle travel-wheel artwork rotating in opposite directions as the page scrolls on wide screens.

---

## 🛠️ Technology Stack

- **Runtime**: Node.js (v20+ / v24)
- **Backend**: Express.js
- **Database**: **Supabase (PostgreSQL)** only; credentials are required for authentication and itinerary features
- **Frontend**: Semantic HTML5, Vanilla JavaScript (ES6+), Vanilla CSS3 (Custom design system, glassmorphism, responsive flex/grid)
- **External APIs**:
  - [Open-Meteo Weather API](https://open-meteo.com/) (Live real-time forecast - no key required)
  - [Wikimedia Commons API](https://commons.wikimedia.org/w/api.php) (Openly licensed destination imagery and attribution - no key required)
  - [OpenTripMap API](https://opentripmap.io/) (Optional place search when configured in `.env`)
  - [OpenRouter API](https://openrouter.ai/) (Authenticated itinerary text chat)
  - [NVIDIA Qwen-Image NIM](https://build.nvidia.com/qwen/qwen-image) (Authenticated AI-generated destination posters)
- **Testing**: Node.js native test runner (`node:test`, `node:assert`)

---

## ⚙️ Environment Variables Setup

Create a `.env` file in the root directory:

```env
PORT=3000

# Supabase Database Configuration (PostgreSQL)
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_api_key

# Optional external place search
OPENTRIPMAP_API_KEY=your_opentripmap_key_here

# OpenRouter-powered itinerary chat
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_CHAT_MODEL=openai/gpt-4o-mini
APP_URL=http://localhost:3000

# NVIDIA NIM-powered AI poster generation
NVIDIA_API_KEY_for_Posters=your_nvidia_api_key
```

> **Database requirement**: Supabase is the application's only database. Configure `SUPABASE_URL` and `SUPABASE_KEY` before using registration, login, or itinerary features. Public destination browsing can still be used without Supabase.
>
> **Security Note**: Passwords and private API keys are never exposed in client endpoints or logs. Database writes and removals are verified against Supabase.
>
> **AI setup**: Set `OPENROUTER_API_KEY` to enable itinerary text chat and `NVIDIA_API_KEY_for_Posters` to enable poster generation. Both keys stay on the server. NVIDIA NIM API Catalog usage is subject to NVIDIA account limits and availability. Generated poster images are returned to the browser for download and are not saved to the database.

For existing Supabase installations, run `supabase_schema.sql` in the Supabase SQL Editor so the `itinerary.user_id` ownership column is present. Older itinerary entries that were stored as shared guest data are intentionally not assigned to any account because their owner cannot be determined safely.

---

## 🏁 Setup & Run Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Database & Unit Tests
```bash
npm test
```

### 3. Start Application
```bash
npm start
```
The server will start at `http://localhost:3000`. Open your browser and navigate to:
```
http://localhost:3000
```

### Deploy to Vercel
Import the GitHub repository into Vercel and add the required environment variables in **Project Settings → Environment Variables**. Set `SUPABASE_URL` and `SUPABASE_KEY` for account and itinerary features. Add `OPENROUTER_API_KEY` and `NVIDIA_API_KEY_for_Posters` to enable AI chat and poster generation. Do not commit `.env` or paste secrets into source files.

Vercel serves this Express app through its default export in `server.js`. After changing environment variables, redeploy so the new values are applied.

---

## 📡 REST API Documentation

### 1. Get Destinations
- **Endpoint**: `GET /api/destinations`
- **Query Parameters**:
  - `q` (string): Search term (e.g. `paris`, `nature`)
  - `category` (string): Filter by category (`Landmark`, `Culture`, `Nature`, `Beach`, `Adventure`)
  - `sortBy` (string): `rating`, `name-asc`, `name-desc`, `temp-desc`, `temp-asc`
- **Response `(200 OK)`**:
```json
{
  "success": true,
  "count": 12,
  "data": [
    {
      "id": "dest-1",
      "name": "Eiffel Tower & Seine River",
      "city": "Paris",
      "country": "France",
      "category": "Landmark",
      "rating": 4.8,
      "lat": 48.8584,
      "lon": 2.2945,
      "description": "Iconic wrought-iron lattice tower on the Champ de Mars...",
      "image_url": "https://images.unsplash.com/...",
      "image_credit": "Photographer · CC BY-SA 4.0",
      "image_credit_url": "https://commons.wikimedia.org/wiki/File:...",
      "tags": ["Architecture", "Romance", "Iconic"],
      "weather": {
        "temp": 19,
        "apparent_temp": 19,
        "humidity": 65,
        "wind_speed": 12.4,
        "condition": "Partly Cloudy",
        "icon": "⛅",
        "code": 2,
        "observed_at": "2026-10-18T10:00"
      }
    }
  ]
}
```

### 2. Get Destination Details
- **Endpoint**: `GET /api/destinations/:id`
- **Response `(200 OK)`**: Single destination object with real-time weather data.

### 3. Get Saved Itinerary
- **Endpoint**: `GET /api/itinerary`
- **Response `(200 OK)`**:
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "itin-171800000-xyz",
      "destination_id": "dest-1",
      "name": "Eiffel Tower & Seine River",
      "city": "Paris",
      "country": "France",
      "category": "Landmark",
      "rating": 4.8,
      "image_url": "https://images.unsplash.com/...",
      "notes": "Visit during sunset",
      "planned_date": "2026-11-20",
      "created_at": "2026-10-16 10:20:00"
    }
  ]
}
```

### 4. Add Destination to Itinerary
- **Endpoint**: `POST /api/itinerary`
- **Request Body**:
```json
{
  "destination_id": "dest-1",
  "name": "Eiffel Tower & Seine River",
  "city": "Paris",
  "country": "France",
  "category": "Landmark",
  "rating": 4.8,
  "image_url": "https://images.unsplash.com/...",
  "notes": "Visit during sunset",
  "planned_date": "2026-11-20"
}
```
- **Response `(201 Created)`**: Saved record object.

### 5. Remove Destination from Itinerary
- **Endpoint**: `DELETE /api/itinerary/:id`
- **Response `(200 OK)`**:
```json
{
  "success": true,
  "message": "Itinerary item removed successfully",
  "id": "itin-171800000-xyz"
}
```

### 6. Health & Config Status
- **Endpoint**: `GET /api/config`
- **Response `(200 OK)`**: Status of the configured database and third-party APIs.

---

## 🗄️ Supabase Database Schema

The application stores user and itinerary records only in Supabase PostgreSQL. Set up the tables and ownership column by running [supabase_schema.sql](./supabase_schema.sql) in the Supabase SQL Editor.

---

## 📁 Project Structure

```
├── .env                  # Local environment configuration (API keys)
├── .gitignore            # Git ignore file for secrets & artifacts
├── package.json          # Node.js project manifest & scripts
├── server.js             # Express server, Supabase access, REST APIs, & external services
├── test.js               # Native unit tests for CRUD and filtering logic
├── supabase_schema.sql   # Supabase PostgreSQL schema
├── APP_DOCUMENTATION.md  # Application behavior, architecture, integrations & API guide
├── public/
│   ├── tripwise-logo.png # Brand logo, app icon, and authentication mark
│   ├── plane-cursor.svg  # Custom airplane cursor for pointer devices
│   ├── index.html        # Semantic HTML layout (Explore, Details modal, Itinerary)
│   ├── styles.css        # Responsive styling, cards, status pills, and modals
│   └── app.js            # Client-side state, API integration, and DOM updates
└── README.md             # Project documentation & submission guide
```
