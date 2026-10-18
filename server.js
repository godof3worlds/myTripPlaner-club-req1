import express from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || 'openai/gpt-4o-mini';
const NVIDIA_IMAGE_MODEL = 'qwen/qwen-image';
const NVIDIA_IMAGE_ENDPOINT = 'https://ai.api.nvidia.com/v1/genai/qwen/qwen-image';

function getNvidiaPosterApiKey() {
  return process.env.NVIDIA_API_KEY_for_Posters || process.env.NVIDIA_API_KEY;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Supabase Database Configuration ---
const isSupabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
let supabase = null;

if (isSupabaseConfigured) {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err.message);
    supabase = null;
  }
}

function requireSupabase() {
  if (!supabase) {
    const error = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY.');
    error.code = 'SUPABASE_NOT_CONFIGURED';
    throw error;
  }
  return supabase;
}

function databaseErrorStatus(error) {
  return error.code === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500;
}

// --- Password Hashing & Authentication Security (node:crypto stdlib) ---

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  try {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch (err) {
    return false;
  }
}

// Active session tokens: token -> { userId, email, name, expiresAt }
const sessionStore = new Map();

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (token && sessionStore.has(token)) {
    const session = sessionStore.get(token);
    if (Date.now() < session.expiresAt) {
      req.user = session;
      req.userId = session.userId;
      return next();
    } else {
      sessionStore.delete(token);
    }
  }
  req.user = null;
  req.userId = 'guest';
  next();
}

app.use(authMiddleware);

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Please sign in to access your itinerary' });
  }
  next();
}

app.use('/api/itinerary', requireAuth);

// --- User Database Operations (Strictly zero sensitive leaks) ---

async function dbFindUserByEmail(email) {
  const normalized = email.toLowerCase().trim();
  const { data, error } = await requireSupabase()
    .from('users')
    .select('*')
    .eq('email', normalized)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function dbCreateUser({ id, email, password_hash, salt, name }) {
  const normalized = email.toLowerCase().trim();
  const client = requireSupabase();
  const { error: insertError } = await client.from('users').insert({
    id,
    email: normalized,
    password_hash,
    salt,
    name
  });
  if (insertError) throw insertError;

  const { data: confirmed, error: confirmError } = await client
    .from('users')
    .select('id, email, name, created_at')
    .eq('id', id)
    .single();
  if (confirmError) throw confirmError;
  if (!confirmed) throw new Error('Database write confirmation failed: User could not be verified in Supabase');
  return confirmed;
}

// --- Itinerary Database Operations with Confirmation ---

async function dbGetAllItinerary(userId) {
  const { data, error } = await requireSupabase()
    .from('itinerary')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function dbFindItineraryByDestinationId(destId, userId) {
  const { data, error } = await requireSupabase()
    .from('itinerary')
    .select('id')
    .eq('destination_id', destId)
    .eq('user_id', userId)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function dbAddItinerary(record) {
  const client = requireSupabase();
  const { error: insertError } = await client.from('itinerary').insert(record);
  if (insertError) throw insertError;

  const { data: confirmed, error: confirmError } = await client
    .from('itinerary')
    .select('*')
    .eq('id', record.id)
    .eq('user_id', record.user_id)
    .single();
  if (confirmError) throw confirmError;
  if (!confirmed) throw new Error('Database write confirmation failed: Record could not be verified in Supabase');
  return confirmed;
}

async function dbDeleteItinerary(id, userId) {
  const client = requireSupabase();
  const { error: deleteError } = await client
    .from('itinerary')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (deleteError) throw deleteError;

  const { data: remaining, error: confirmError } = await client
    .from('itinerary')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId);
  if (confirmError) throw confirmError;
  if (remaining?.length) throw new Error('Database deletion confirmation failed: Record still present');
  return true;
}

async function dbZeroItinerary(userId) {
  const client = requireSupabase();
  const { error: deleteError } = await client.from('itinerary').delete().eq('user_id', userId);
  if (deleteError) throw deleteError;

  const { count, error: countError } = await client
    .from('itinerary')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (countError) throw countError;
  if (count !== 0) throw new Error(`Database zero verification failed: ${count} items remain in Supabase`);
  return true;
}

// --- Curated Destinations ---
const BASE_DESTINATIONS = [
  {
    id: 'dest-1',
    name: 'Eiffel Tower & Seine River',
    city: 'Paris',
    country: 'France',
    category: 'Landmark',
    rating: 4.8,
    lat: 48.8584,
    lon: 2.2945,
    description: 'Iconic wrought-iron lattice tower on the Champ de Mars, offering panoramic vistas over Paris and romantic evening light shows.',
    image_url: 'https://images.unsplash.com/photo-1511739001486-6bfe10ce785f?auto=format&fit=crop&w=800&q=80',
    tags: ['Architecture', 'Romance', 'Iconic', 'Culture']
  },
  {
    id: 'dest-2',
    name: 'Shibuya Crossing & Meiji Shrine',
    city: 'Tokyo',
    country: 'Japan',
    category: 'Culture',
    rating: 4.9,
    lat: 35.6595,
    lon: 139.7005,
    description: 'A striking blend of high-energy neon intersections and serene evergreen forest shrines right in the vibrant heart of Tokyo.',
    image_url: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=800&q=80',
    tags: ['Urban', 'Tradition', 'Street Food', 'Shopping']
  },
  {
    id: 'dest-3',
    name: 'The Colosseum & Roman Forum',
    city: 'Rome',
    country: 'Italy',
    category: 'Landmark',
    rating: 4.9,
    lat: 41.8902,
    lon: 12.4922,
    description: 'The monumental stone amphitheatre constructed under the Flavian emperors, preserving two millennia of gladiatorial and imperial history.',
    image_url: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=800&q=80',
    tags: ['History', 'Ancient', 'Ruins', 'UNESCO']
  },
  {
    id: 'dest-4',
    name: 'Ubud Sacred Monkey Forest & Rice Terraces',
    city: 'Bali',
    country: 'Indonesia',
    category: 'Nature',
    rating: 4.7,
    lat: -8.5194,
    lon: 115.2632,
    description: 'Lush tropical sanctuary with centuries-old temples, terraced emerald paddies, and a rich spiritual cultural community.',
    image_url: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=800&q=80',
    tags: ['Tropical', 'Wildlife', 'Spiritual', 'Relaxation']
  },
  {
    id: 'dest-5',
    name: 'Central Park & Skyline',
    city: 'New York City',
    country: 'United States',
    category: 'Landmark',
    rating: 4.8,
    lat: 40.7829,
    lon: -73.9654,
    description: 'An expansive urban oasis framed by legendary skyscraper vistas, offering museums, boating lakes, and year-round cultural events.',
    image_url: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?auto=format&fit=crop&w=800&q=80',
    tags: ['Skyline', 'Parks', 'Food', 'Museums']
  },
  {
    id: 'dest-6',
    name: 'Table Mountain & Boulder Beach',
    city: 'Cape Town',
    country: 'South Africa',
    category: 'Adventure',
    rating: 4.8,
    lat: -33.9575,
    lon: 18.4031,
    description: 'Flat-topped mountain providing dramatic sea-to-sky panoramas, home to rare fynbos flora, hiking ridges, and penguin colonies.',
    image_url: 'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?auto=format&fit=crop&w=800&q=80',
    tags: ['Hiking', 'Coastline', 'Wildlife', 'Views']
  },
  {
    id: 'dest-7',
    name: 'Sydney Opera House & Harbour',
    city: 'Sydney',
    country: 'Australia',
    category: 'Landmark',
    rating: 4.7,
    lat: -33.8568,
    lon: 151.2153,
    description: 'UNESCO World Heritage performing arts centre famed for its soaring sail-shaped shells set against a world-renowned harbour.',
    image_url: 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=800&q=80',
    tags: ['Coastal', 'Modern', 'Sailing', 'Arts']
  },
  {
    id: 'dest-8',
    name: 'Matterhorn Peak & Zermatt Village',
    city: 'Zermatt',
    country: 'Switzerland',
    category: 'Adventure',
    rating: 4.9,
    lat: 45.9763,
    lon: 7.7491,
    description: 'Majestic pyramid-shaped Alpine summit towering above car-free chalets, world-class ski trails, and crystal-clear glacier lakes.',
    image_url: 'https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?auto=format&fit=crop&w=800&q=80',
    tags: ['Alps', 'Snow', 'Skiing', 'Scenic']
  },
  {
    id: 'dest-9',
    name: 'Oia Cliffs & Caldera Sunset',
    city: 'Santorini',
    country: 'Greece',
    category: 'Beach',
    rating: 4.9,
    lat: 36.4618,
    lon: 25.3753,
    description: 'Whitewashed cubiform cliff houses and cobalt-blue domed churches perched over the volcanic Aegean caldera.',
    image_url: 'https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?auto=format&fit=crop&w=800&q=80',
    tags: ['Sunset', 'Islands', 'Mediterranean', 'Scenic']
  },
  {
    id: 'dest-10',
    name: 'Basílica de la Sagrada Família',
    city: 'Barcelona',
    country: 'Spain',
    category: 'Culture',
    rating: 4.9,
    lat: 41.4036,
    lon: 2.1744,
    description: "Antoni Gaudí's unfinished masterpiece displaying organic stone spires, kaleidoscopic stained-glass tree canopies, and Catalan modernism.",
    image_url: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?auto=format&fit=crop&w=800&q=80',
    tags: ['Architecture', 'Gaudí', 'UNESCO', 'Art']
  },
  {
    id: 'dest-11',
    name: 'Christ the Redeemer & Copacabana',
    city: 'Rio de Janeiro',
    country: 'Brazil',
    category: 'Beach',
    rating: 4.7,
    lat: -22.9519,
    lon: -43.2105,
    description: 'Art Deco colossus atop Mount Corcovado overlooking sweeping golden Atlantic beaches, Tijuca rainforest, and Sugarloaf peak.',
    image_url: 'https://images.unsplash.com/photo-1483729558449-99ef09a8c325?auto=format&fit=crop&w=800&q=80',
    tags: ['Beaches', 'Carnival', 'Rainforest', 'Vibrant']
  },
  {
    id: 'dest-12',
    name: 'Arashiyama Bamboo Grove & Tenryu-ji',
    city: 'Kyoto',
    country: 'Japan',
    category: 'Nature',
    rating: 4.8,
    lat: 35.0164,
    lon: 135.6713,
    description: 'Swaying emerald bamboo stalks whispering in the mountain breeze beside historic Zen Buddhist gardens and traditional tea houses.',
    image_url: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=800&q=80',
    tags: ['Zen', 'Nature', 'Buddhism', 'Photography']
  }
];

// --- Weather Code Helper ---
function interpretWeatherCode(code) {
  if (code === 0) return { condition: 'Clear Sky', icon: '☀️' };
  if (code <= 3) return { condition: 'Partly Cloudy', icon: '⛅' };
  if (code <= 48) return { condition: 'Foggy', icon: '🌫️' };
  if (code <= 67) return { condition: 'Rain', icon: '🌧️' };
  if (code <= 77) return { condition: 'Snow', icon: '❄️' };
  if (code <= 82) return { condition: 'Rain Showers', icon: '🌦️' };
  return { condition: 'Thunderstorm', icon: '⛈️' };
}

// Weather Cache (10 minutes TTL)
const weatherCache = new Map();

async function getLiveWeather(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const now = Date.now();
  if (weatherCache.has(key)) {
    const cached = weatherCache.get(key);
    if (now - cached.timestamp < 10 * 60 * 1000) {
      return cached.data;
    }
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);
    const json = await res.json();
    const current = json.current;
    const meta = interpretWeatherCode(current.weather_code);
    const data = {
      temp: Math.round(current.temperature_2m),
      apparent_temp: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind_speed: current.wind_speed_10m,
      condition: meta.condition,
      icon: meta.icon,
      code: current.weather_code,
      observed_at: current.time
    };
    weatherCache.set(key, { timestamp: now, data });
    return data;
  } catch (err) {
    console.warn(`Open-Meteo weather request failed for ${key}:`, err.message);
    return null;
  }
}

// Wikimedia Commons image cache (24-hour TTL)
const destinationImageCache = new Map();

function metadataText(value = '') {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

async function getDestinationImage(destination) {
  const key = `${destination.name}|${destination.city}|${destination.country}`.toLowerCase();
  const now = Date.now();
  const cached = destinationImageCache.get(key);
  const cacheTtl = cached?.data ? 24 * 60 * 60 * 1000 : cached?.retryAfterMs || 60 * 1000;
  if (cached && now - cached.timestamp < cacheTtl) {
    return cached.data;
  }

  try {
    const placeName = destination.name.split(/\s[&/]\s/)[0].replace(/^(the|a|an)\s+/i, '').trim();
    const query = placeName || destination.name;
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: '5',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: '800',
      format: 'json'
    });
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'TripWise travel planner/1.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      const error = new Error(`Wikimedia Commons request failed: ${response.status}`);
      const retryAfter = Number(response.headers.get('retry-after'));
      error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 60 * 1000;
      throw error;
    }

    const result = await response.json();
    const pages = Object.values(result.query?.pages || {});
    const candidates = pages.filter(item => {
      const info = item.imageinfo?.[0];
      return (info?.thumburl?.startsWith('https://upload.wikimedia.org/') ||
        info?.thumburl?.startsWith('https://thumb.wikimedia.org/')) &&
        (!info.mime || info.mime.startsWith('image/'));
    });
    const page = candidates.find(item => !/\b(lightning|construction|map|logo|diagram)\b/i.test(item.title)) ||
      candidates[0];
    const info = page?.imageinfo?.[0];
    const metadata = info?.extmetadata || {};
    const artist = metadataText(metadata.Artist?.value || '');
    const license = metadataText(metadata.LicenseShortName?.value || '');
    const creditUrl = info?.descriptionurl || info?.url;
    const image = info && creditUrl?.startsWith('https://commons.wikimedia.org/') ? {
      image_url: info.thumburl,
      image_credit: [artist, license].filter(Boolean).join(' · ') || 'Wikimedia Commons',
      image_credit_url: creditUrl
    } : null;

    destinationImageCache.set(key, { timestamp: now, data: image });
    return image;
  } catch (err) {
    console.warn(`Wikimedia Commons image lookup failed for ${key}:`, err.message);
    destinationImageCache.set(key, {
      timestamp: now,
      data: null,
      retryAfterMs: err.retryAfterMs || 60 * 1000
    });
    return null;
  }
}

// OpenTripMap External Places Fetcher
async function fetchOpenTripMapPlaces(query) {
  const apiKey = process.env.OPENTRIPMAP_API_KEY;
  if (!apiKey) return null;

  try {
    const geoUrl = `https://api.opentripmap.com/0.1/en/places/geoname?name=${encodeURIComponent(query)}&apikey=${apiKey}`;
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(4000) });
    if (!geoRes.ok) return null;
    const geoname = await geoRes.json();
    if (!geoname || geoname.status !== 'OK' || !geoname.lat || !geoname.lon) return null;

    const placesUrl = `https://api.opentripmap.com/0.1/en/places/radius?radius=15000&lon=${geoname.lon}&lat=${geoname.lat}&kinds=interesting_places,cultural,historic,natural&format=json&limit=24&apikey=${apiKey}`;
    const placesRes = await fetch(placesUrl, { signal: AbortSignal.timeout(5000) });
    if (!placesRes.ok) return null;
    const rawPlaces = await placesRes.json();
    if (!Array.isArray(rawPlaces) || rawPlaces.length === 0) return null;

    return rawPlaces
      .filter(p => p.name && p.name.trim().length > 2)
      .map((p, idx) => {
        let cat = 'Landmark';
        const kinds = p.kinds || '';
        if (kinds.includes('natural')) cat = 'Nature';
        else if (kinds.includes('cultural') || kinds.includes('museums')) cat = 'Culture';
        else if (kinds.includes('sport') || kinds.includes('amusements')) cat = 'Adventure';

        return {
          id: `otm-${p.xid || idx}`,
          name: p.name,
          city: geoname.name,
          country: geoname.country,
          category: cat,
          rating: Number((4.5 + ((p.rate || 1) * 0.1)).toFixed(1)),
          lat: p.point.lat,
          lon: p.point.lon,
          description: `Historic and cultural attraction in ${geoname.name} discovered via OpenTripMap.`,
          image_url: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80',
          tags: ['OpenTripMap', geoname.name, cat]
        };
      });
  } catch (err) {
    console.error('OpenTripMap lookup error:', err.message);
    return null;
  }
}

// --- AUTHENTICATION ENDPOINTS (Zero Sensitive Leaks) ---

// Register New User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name = '' } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email address is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const existing = await dbFindUserByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });
    }

    const { salt, hash } = hashPassword(password);
    const userId = `usr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const createdUser = await dbCreateUser({
      id: userId,
      email,
      password_hash: hash,
      salt,
      name: name.trim() || email.split('@')[0]
    });

    // Create session token
    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      userId: createdUser.id,
      email: createdUser.email,
      name: createdUser.name,
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000 // 7 days
    };
    sessionStore.set(token, session);

    // Sanitized response: password_hash and salt are NEVER sent
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        id: createdUser.id,
        email: createdUser.email,
        name: createdUser.name
      }
    });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(databaseErrorStatus(err)).json({
      success: false,
      error: err.code === 'SUPABASE_NOT_CONFIGURED'
        ? err.message
        : 'Account registration failed'
    });
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const user = await dbFindUserByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const isValid = verifyPassword(password, user.salt, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // Create session token
    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      userId: user.id,
      email: user.email,
      name: user.name,
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000
    };
    sessionStore.set(token, session);

    // Sanitized response
    res.json({
      success: true,
      message: 'Logged in successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(databaseErrorStatus(err)).json({
      success: false,
      error: err.code === 'SUPABASE_NOT_CONFIGURED'
        ? err.message
        : 'Authentication failed'
    });
  }
});

// Get Current User Profile
app.get('/api/auth/me', (req, res) => {
  if (req.user) {
    res.json({
      success: true,
      authenticated: true,
      user: {
        id: req.user.userId,
        email: req.user.email,
        name: req.user.name
      }
    });
  } else {
    res.json({
      success: true,
      authenticated: false,
      user: null
    });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (token) sessionStore.delete(token);

  res.json({ success: true, message: 'Logged out successfully' });
});

// --- GENERAL REST API ROUTES ---

// Health & Config status (Sanitized: NEVER leaks passwords or sensitive secrets)
app.get('/api/config', (req, res) => {
  res.json({
    status: 'online',
    track: 'Track 3: Full-Stack Development',
    database: {
      engine: 'Supabase (PostgreSQL)',
      configured: Boolean(supabase)
    },
    externalApis: {
      openMeteo: { name: 'Open-Meteo Weather API', active: true, keyRequired: false },
      openTripMap: { name: 'OpenTripMap API', active: Boolean(process.env.OPENTRIPMAP_API_KEY), keyRequired: true },
      openRouter: {
        name: 'OpenRouter AI',
        active: Boolean(process.env.OPENROUTER_API_KEY),
        keyRequired: true,
        chatModel: OPENROUTER_CHAT_MODEL
      },
      nvidia: {
        name: 'NVIDIA NIM Image Generation',
        active: Boolean(getNvidiaPosterApiKey()),
        keyRequired: true,
        imageModel: NVIDIA_IMAGE_MODEL
      }
    }
  });
});

const POSTER_REQUEST_PATTERN = /\b(poster|generate(?:\s+me)?\s+(?:an?\s+)?(?:image|artwork|illustration)|create\s+(?:an?\s+)?(?:image|artwork|illustration)|make\s+(?:an?\s+)?(?:image|artwork|illustration)|draw|illustrate)\b/i;

function getOpenRouterHeaders() {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.APP_URL || `http://localhost:${PORT}`,
    'X-Title': 'TripWise'
  };
}

async function getOpenRouterError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || body?.message || '';
  } catch {
    detail = '';
  }
  return detail
    ? `OpenRouter request failed (${response.status}): ${String(detail).slice(0, 300)}`
    : `OpenRouter request failed (${response.status})`;
}

async function generateNvidiaPoster(imagePrompt) {
  const response = await fetch(NVIDIA_IMAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getNvidiaPosterApiKey()}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt: imagePrompt,
      width: 1056,
      height: 1584
    }),
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('NVIDIA returned 404 for Qwen-Image. Confirm this model is enabled for hosted API access on your NVIDIA account.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('NVIDIA rejected the API key or denied access to Qwen-Image. Check the key and model access in NVIDIA Build.');
    }
    if (response.status === 429) {
      throw new Error('NVIDIA Qwen-Image rate limit or quota was reached. Please try again later.');
    }
    throw new Error(`NVIDIA NIM image request failed (${response.status}).`);
  }

  const result = await response.json();
  const artifact = result?.image ?? result?.images?.[0] ?? result?.artifacts?.[0];
  const encodedImage = typeof artifact === 'string'
    ? artifact
    : artifact?.base64 ?? artifact?.b64_json ?? artifact?.image ?? artifact?.data;
  if (typeof encodedImage !== 'string' || artifact?.finishReason === 'ERROR') {
    throw new Error('NVIDIA NIM did not return a generated image. Please try again.');
  }

  const dataUrlMatch = encodedImage.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i);
  const mediaType = dataUrlMatch?.[1].toLowerCase() || 'image/png';
  const base64 = dataUrlMatch?.[2] || encodedImage;
  const maxImageBytes = 15 * 1024 * 1024;
  const maxBase64Length = Math.ceil(maxImageBytes / 3) * 4;
  if (
    base64.length > maxBase64Length ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw new Error('NVIDIA NIM returned an invalid or oversized image. Please try again.');
  }

  const imageBuffer = Buffer.from(base64, 'base64');
  const isPng = imageBuffer.length >= 8 && imageBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = imageBuffer.length >= 3 && imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff;
  const isWebp = imageBuffer.length >= 12 && imageBuffer.toString('ascii', 0, 4) === 'RIFF' && imageBuffer.toString('ascii', 8, 12) === 'WEBP';
  const matchesMediaType = (mediaType === 'image/png' && isPng)
    || (mediaType === 'image/jpeg' && isJpeg)
    || (mediaType === 'image/webp' && isWebp);
  if (imageBuffer.length > maxImageBytes || !matchesMediaType) {
    throw new Error('NVIDIA NIM returned an invalid or oversized image. Please try again.');
  }

  return {
    dataUrl: `data:${mediaType};base64,${base64}`,
    mediaType
  };
}

app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const { destinationId, message, history = [] } = req.body || {};
  const prompt = typeof message === 'string' ? message.trim() : '';
  if (!destinationId || !prompt) {
    return res.status(400).json({ success: false, error: 'Choose an itinerary destination and enter a message.' });
  }
  if (prompt.length > 1600) {
    return res.status(400).json({ success: false, error: 'Messages must be 1,600 characters or fewer.' });
  }
  if (!Array.isArray(history) || history.length > 12) {
    return res.status(400).json({ success: false, error: 'Chat history is invalid. Start a new message.' });
  }
  const isPosterRequest = POSTER_REQUEST_PATTERN.test(prompt);
  if (isPosterRequest && !getNvidiaPosterApiKey()) {
    return res.status(503).json({
      success: false,
      error: 'Poster generation is not configured yet. Add NVIDIA_API_KEY_for_Posters to the server environment.'
    });
  }
  if (!isPosterRequest && !process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'AI chat is not configured yet. Add OPENROUTER_API_KEY to the server environment.'
    });
  }

  try {
    const itinerary = await dbGetAllItinerary(req.userId);
    const destination = itinerary.find(item => item.id === destinationId);
    if (!destination) {
      return res.status(404).json({ success: false, error: 'That destination is not in your itinerary.' });
    }

    const destinationContext = [
      `Selected destination: ${destination.name}`,
      `Location: ${[destination.city, destination.country].filter(Boolean).join(', ')}`,
      `Category: ${destination.category || 'Travel'}`,
      destination.description ? `Description: ${destination.description}` : '',
      destination.planned_date ? `Planned date: ${destination.planned_date}` : '',
      destination.notes ? `Traveler notes: ${destination.notes}` : ''
    ].filter(Boolean).join('\n');

    if (isPosterRequest) {
      const imagePrompt = [
        'Create a polished, premium travel poster artwork for the selected destination. Make it visually striking and suitable for a traveler to save or print.',
        'Use an elegant editorial travel-poster composition, strong focal scenery, rich natural colors, refined lighting, and clean margins.',
        'Include the destination name as the prominent title only if the model can render it clearly; do not invent other text, logos, signatures, or watermarks.',
        destinationContext,
        `Traveler's poster direction: ${prompt}`
      ].join('\n\n');

      let image;
      try {
        image = await generateNvidiaPoster(imagePrompt);
      } catch (error) {
        console.error('NVIDIA NIM poster generation failed:', error.message);
        const status = error.name === 'TimeoutError' ? 504 : 502;
        return res.status(status).json({
          success: false,
          error: status === 504
            ? 'Poster generation took too long. Please try again.'
            : error.message
        });
      }

      return res.json({
        success: true,
        type: 'image',
        reply: `Your ${destination.name} poster is ready.`,
        image
      });
    }

    const conversation = history
      .filter(entry => entry && ['user', 'assistant'].includes(entry.role) && typeof entry.content === 'string')
      .slice(-10)
      .map(entry => ({ role: entry.role, content: entry.content.slice(0, 1600) }));
    conversation.push({ role: 'user', content: prompt });

    const chatResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: getOpenRouterHeaders(),
      body: JSON.stringify({
        model: OPENROUTER_CHAT_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are TripWise, a helpful travel-planning assistant. Answer using the selected destination context. Be practical and concise, do not claim live facts unless provided, and do not invent bookings or itinerary changes.\n\n${destinationContext}`
          },
          ...conversation
        ],
        max_tokens: 500,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!chatResponse.ok) {
      return res.status(502).json({ success: false, error: await getOpenRouterError(chatResponse) });
    }
    const chatResult = await chatResponse.json();
    const reply = chatResult?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      console.error('OpenRouter chat response did not contain a text reply.');
      return res.status(502).json({ success: false, error: 'The AI returned an empty reply. Please try again.' });
    }

    res.json({ success: true, type: 'text', reply: reply.trim() });
  } catch (error) {
    console.error(`${isPosterRequest ? 'NVIDIA NIM image' : 'OpenRouter chat'} request failed:`, error.message);
    const status = error.code === 'SUPABASE_NOT_CONFIGURED' ? 503 : error.name === 'TimeoutError' ? 504 : 500;
    res.status(status).json({
      success: false,
      error: status === 504
        ? 'The AI request took too long. Please try again.'
        : status === 503
          ? error.message
          : 'Could not complete the AI request. Please try again.'
    });
  }
});

// Destination Exploration: Search, Filter, Sort, Live Weather
app.get('/api/destinations', async (req, res) => {
  try {
    const { q, category, sortBy, minRating } = req.query;
    let list = [...BASE_DESTINATIONS];

    if (q && process.env.OPENTRIPMAP_API_KEY) {
      const externalOtm = await fetchOpenTripMapPlaces(q);
      if (externalOtm && externalOtm.length > 0) list = [...externalOtm, ...list];
    }

    if (q) {
      const term = q.toLowerCase().trim();
      list = list.filter(item =>
        item.name.toLowerCase().includes(term) ||
        item.city.toLowerCase().includes(term) ||
        item.country.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(term)))
      );
    }

    if (category && category.toLowerCase() !== 'all') {
      const cat = category.toLowerCase().trim();
      list = list.filter(item => item.category.toLowerCase() === cat);
    }

    if (minRating) {
      const min = parseFloat(minRating);
      if (!isNaN(min)) list = list.filter(item => item.rating >= min);
    }

    const enrichedList = await Promise.all(
      list.map(async dest => {
        const [weather, image] = await Promise.all([
          getLiveWeather(dest.lat, dest.lon),
          getDestinationImage(dest)
        ]);
        return { ...dest, weather, ...(image || {}) };
      })
    );

    if (sortBy === 'name-asc') {
      enrichedList.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'name-desc') {
      enrichedList.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortBy === 'temp-desc') {
      enrichedList.sort((a, b) => (b.weather?.temp ?? 0) - (a.weather?.temp ?? 0));
    } else if (sortBy === 'temp-asc') {
      enrichedList.sort((a, b) => (a.weather?.temp ?? 0) - (b.weather?.temp ?? 0));
    } else {
      enrichedList.sort((a, b) => b.rating - a.rating);
    }

    res.json({
      success: true,
      count: enrichedList.length,
      data: enrichedList
    });
  } catch (err) {
    console.error('Error fetching destinations:', err.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve destinations' });
  }
});

// Destination Details
app.get('/api/destinations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const dest = BASE_DESTINATIONS.find(d => d.id === id);
    if (!dest) {
      return res.status(404).json({ success: false, error: 'Destination not found' });
    }
    const [weather, image] = await Promise.all([
      getLiveWeather(dest.lat, dest.lon),
      getDestinationImage(dest)
    ]);
    res.json({
      success: true,
      data: { ...dest, weather, ...(image || {}) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error fetching destination details' });
  }
});

// Itinerary Management: Get All Items (Scoped to user, confirmed with DB)
app.get('/api/itinerary', async (req, res) => {
  try {
    const items = await dbGetAllItinerary(req.userId);
    res.json({
      success: true,
      count: items.length,
      data: items
    });
  } catch (err) {
    console.error('Database query error:', err.message);
    res.status(databaseErrorStatus(err)).json({ success: false, error: 'Failed to read Supabase itinerary' });
  }
});

// Itinerary Management: Add Destination (Confirmed with DB)
app.post('/api/itinerary', async (req, res) => {
  try {
    const {
      id = `itin-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      destination_id,
      name,
      city,
      country,
      category = 'General',
      description = '',
      rating = 5.0,
      image_url = '',
      notes = '',
      planned_date = ''
    } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Destination name is required' });
    }

    if (destination_id) {
      const existing = await dbFindItineraryByDestinationId(destination_id, req.userId);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'Destination is already in your itinerary',
          existingId: existing.id
        });
      }
    }

    const newRecord = {
      id,
      user_id: req.userId,
      destination_id: destination_id || id,
      name: name.trim(),
      city: city || '',
      country: country || '',
      category,
      description,
      rating: Number(rating) || 5.0,
      image_url,
      notes,
      planned_date
    };

    const confirmedRecord = await dbAddItinerary(newRecord);

    res.status(201).json({
      success: true,
      message: 'Added and confirmed in database',
      data: confirmedRecord
    });
  } catch (err) {
    console.error('Database insert error:', err.message);
    res.status(databaseErrorStatus(err)).json({ success: false, error: 'Failed to save and confirm itinerary item in Supabase' });
  }
});

// Itinerary Management: Delete Destination (Confirmed with DB)
app.delete('/api/itinerary/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbDeleteItinerary(id, req.userId);

    res.json({
      success: true,
      message: 'Itinerary item removed and confirmed in database',
      id
    });
  } catch (err) {
    console.error('Database delete error:', err.message);
    res.status(databaseErrorStatus(err)).json({ success: false, error: 'Failed to delete and confirm removal in Supabase' });
  }
});

// Zero Out User Data (Confirmed with DB)
app.post('/api/itinerary/zero', async (req, res) => {
  try {
    await dbZeroItinerary(req.userId);
    res.json({
      success: true,
      message: 'All itinerary data successfully zeroed out and confirmed in database'
    });
  } catch (err) {
    console.error('Database zero error:', err.message);
    res.status(databaseErrorStatus(err)).json({ success: false, error: 'Failed to clear and verify Supabase itinerary' });
  }
});

// Fallback to index.html for all page routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server only when executed directly
const isMain = process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server'));
if (isMain) {
  app.listen(PORT, () => {
    console.log(`TripWise Server running on http://localhost:${PORT}`);
    console.log(`Database: ${supabase ? 'Supabase PostgreSQL' : 'Not configured (set SUPABASE_URL and SUPABASE_KEY)'}`);
    console.log(`Authentication: Active (Salted scrypt hashing, zero leaks)`);
    console.log(`Live Weather: Open-Meteo API (Active)`);
    console.log(`OpenTripMap API: ${process.env.OPENTRIPMAP_API_KEY ? 'Active (Key configured)' : 'Key missing in .env'}`);
    console.log(`OpenRouter AI: ${process.env.OPENROUTER_API_KEY ? 'Active (Key configured)' : 'Key missing in .env'}`);
    console.log(`NVIDIA NIM Image API: ${getNvidiaPosterApiKey() ? 'Active (Key configured)' : 'Key missing in .env'}`);
  });
}

export { app, generateNvidiaPoster, hashPassword, verifyPassword };
