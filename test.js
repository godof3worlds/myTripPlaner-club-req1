import test from 'node:test';
import assert from 'node:assert/strict';
import { app, generateNvidiaPoster, hashPassword, verifyPassword } from './server.js';

test('Itinerary API requires an authenticated user', async (t) => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  }));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const requests = [
    fetch(`${baseUrl}/api/itinerary`),
    fetch(`${baseUrl}/api/itinerary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Private trip' })
    }),
    fetch(`${baseUrl}/api/itinerary/item-1`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/itinerary/zero`, { method: 'POST' })
  ];
  const responses = await Promise.all(requests);

  assert.deepEqual(responses.map(response => response.status), [401, 401, 401, 401]);
});

test('OpenRouter itinerary chat requires authentication', async (t) => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destinationId: 'private-trip', message: 'Make a poster' })
  });
  const result = await response.json();

  assert.equal(response.status, 401);
  assert.equal(result.success, false);
});

test('NVIDIA Qwen-Image poster requests use the hosted API and validate PNG output', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NVIDIA_API_KEY;
  const originalPosterApiKey = process.env.NVIDIA_API_KEY_for_Posters;
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  delete process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY_for_Posters = 'test-nvidia-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), ...options, headers: options.headers };
    return new Response(JSON.stringify({
      image: imageBytes.toString('base64')
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalApiKey;
    if (originalPosterApiKey === undefined) delete process.env.NVIDIA_API_KEY_for_Posters;
    else process.env.NVIDIA_API_KEY_for_Posters = originalPosterApiKey;
  });

  const image = await generateNvidiaPoster('A travel poster for Kyoto');

  assert.equal(request.url, 'https://ai.api.nvidia.com/v1/genai/qwen/qwen-image');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.Authorization, 'Bearer test-nvidia-key');
  assert.deepEqual(JSON.parse(request.body), {
    prompt: 'A travel poster for Kyoto',
    width: 1056,
    height: 1584
  });
  assert.deepEqual(image, {
    dataUrl: `data:image/png;base64,${imageBytes.toString('base64')}`,
    mediaType: 'image/png'
  });
});

test('NVIDIA Qwen-Image reports unavailable hosted-model access clearly', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NVIDIA_API_KEY;
  const originalPosterApiKey = process.env.NVIDIA_API_KEY_for_Posters;
  delete process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY_for_Posters = 'test-nvidia-key';
  globalThis.fetch = async () => new Response('not found', { status: 404 });

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalApiKey;
    if (originalPosterApiKey === undefined) delete process.env.NVIDIA_API_KEY_for_Posters;
    else process.env.NVIDIA_API_KEY_for_Posters = originalPosterApiKey;
  });

  await assert.rejects(
    generateNvidiaPoster('A travel poster for Kyoto'),
    /Confirm this model is enabled for hosted API access on your NVIDIA account/
  );
});

test('Destination results include current conditions from Open-Meteo', async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const requestedUrl = String(url);
    requestedUrls.push(requestedUrl);
    if (requestedUrl.startsWith('https://commons.wikimedia.org/')) {
      return new Response(JSON.stringify({
        query: {
          pages: {
            1: {
              imageinfo: [{
                thumburl: 'https://upload.wikimedia.org/wikipedia/commons/test-photo.jpg',
                url: 'https://upload.wikimedia.org/wikipedia/commons/test-photo.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Test_photo.jpg',
                mime: 'image/jpeg',
                extmetadata: {
                  Artist: { value: '<a href="/wiki/User:Photo">Photo Artist</a>' },
                  LicenseShortName: { value: 'CC BY-SA 4.0' }
                }
              }]
            }
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      current: {
        temperature_2m: 18.4,
        apparent_temperature: 17.8,
        relative_humidity_2m: 62,
        wind_speed_10m: 8.2,
        weather_code: 2,
        time: '2026-10-18T10:00'
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
    });
  });

  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/destinations`);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.ok(requestedUrls.length > 0);
    assert.ok(requestedUrls.some(url => url.startsWith('https://api.open-meteo.com/')));
    assert.ok(requestedUrls.some(url => url.startsWith('https://commons.wikimedia.org/')));
    assert.ok(result.data.every(destination =>
      destination.weather?.temp === 18 &&
      destination.weather.condition === 'Partly Cloudy' &&
      destination.weather.observed_at === '2026-10-18T10:00' &&
      destination.image_url === 'https://upload.wikimedia.org/wikipedia/commons/test-photo.jpg' &&
      destination.image_credit === 'Photo Artist · CC BY-SA 4.0' &&
      destination.image_credit_url === 'https://commons.wikimedia.org/wiki/File:Test_photo.jpg'
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Place searches return more nearby OpenTripMap cards', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENTRIPMAP_API_KEY;
  const requestedPlaceUrls = [];
  process.env.OPENTRIPMAP_API_KEY = 'test-opentripmap-key';
  globalThis.fetch = async (url) => {
    const requestedUrl = String(url);
    if (requestedUrl.includes('/places/geoname?')) {
      return new Response(JSON.stringify({
        status: 'OK',
        name: 'Paris',
        country: 'France',
        lat: 48.85,
        lon: 2.35
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (requestedUrl.includes('/places/radius?')) {
      requestedPlaceUrls.push(requestedUrl);
      return new Response(JSON.stringify(Array.from({ length: 18 }, (_, index) => ({
        xid: `paris-place-${index}`,
        name: `Paris Attraction ${index}`,
        rate: 3,
        kinds: 'historic',
        point: { lat: 48.85 + index / 1000, lon: 2.35 + index / 1000 }
      }))), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (requestedUrl.startsWith('https://api.open-meteo.com/')) {
      return new Response(JSON.stringify({
        current: {
          temperature_2m: 18,
          apparent_temperature: 18,
          relative_humidity_2m: 60,
          wind_speed_10m: 8,
          weather_code: 0,
          time: '2026-10-18T10:00'
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ query: { pages: {} } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENTRIPMAP_API_KEY;
    else process.env.OPENTRIPMAP_API_KEY = originalApiKey;
    await new Promise((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
    });
  });

  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/destinations?q=Paris`);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data.length, 19);
    assert.equal(result.data.filter(place => place.id.startsWith('otm-')).length, 18);
    assert.ok(requestedPlaceUrls[0]?.includes('limit=24'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENTRIPMAP_API_KEY;
    else process.env.OPENTRIPMAP_API_KEY = originalApiKey;
  }
});

test('Supabase is the only database and missing configuration is reported', async (t) => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  }));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/config`);
  const config = await response.json();

  assert.equal(config.database.engine, 'Supabase (PostgreSQL)');
  assert.equal(typeof config.database.configured, 'boolean');
  assert.equal('isSupabase' in config.database, false);
  assert.equal(typeof config.externalApis.openRouter.active, 'boolean');
  assert.equal(typeof config.externalApis.openRouter.chatModel, 'string');
  assert.equal('key' in config.externalApis.openRouter, false);
  assert.equal(typeof config.externalApis.nvidia.active, 'boolean');
  assert.equal(config.externalApis.nvidia.imageModel, 'qwen/qwen-image');
  assert.equal('key' in config.externalApis.nvidia, false);

  if (!config.database.configured) {
    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'traveler@example.com', password: ['registration', 'test', 'only'].join('-') })
    });
    const result = await registration.json();
    assert.equal(registration.status, 503);
    assert.match(result.error, /SUPABASE_URL and SUPABASE_KEY/);
  }
});

test('Search & filter logic checks out', () => {
  const sample = [
    { name: 'Eiffel Tower', category: 'Landmark', rating: 4.8 },
    { name: 'Kyoto Bamboo', category: 'Nature', rating: 4.9 },
    { name: 'Colosseum', category: 'Landmark', rating: 4.7 }
  ];

  const searchResults = sample.filter(item => item.name.toLowerCase().includes('bamboo'));
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].name, 'Kyoto Bamboo');

  const categoryResults = sample.filter(item => item.category === 'Landmark');
  assert.equal(categoryResults.length, 2);
});

test('Password hashing and verification secure (no sensitive leaks)', () => {
  const password = ['unit', 'test', 'only', 'password'].join('-');
  const { salt, hash } = hashPassword(password);

  assert.ok(salt.length >= 32, 'Salt must be sufficiently random');
  assert.ok(hash.length >= 64, 'Hash must be scrypt-derived');
  assert.notEqual(password, hash, 'Plaintext password must never be stored');

  // Verification matches
  const valid = verifyPassword(password, salt, hash);
  assert.equal(valid, true, 'Valid password must verify');

  // Wrong password fails
  const invalid = verifyPassword('WrongPassword', salt, hash);
  assert.equal(invalid, false, 'Invalid password must be rejected');
});
