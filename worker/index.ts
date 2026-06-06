/// <reference types="@cloudflare/workers-types" />

export interface Env {
  ASSETS: Fetcher;
}

const EA_BASE_URL = 'https://environment.data.gov.uk/flood-monitoring';
const API_CACHE_SECONDS = 15 * 60;
const STATION_CACHE_SECONDS = 24 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

type RawStation = {
  '@id'?: string;
  notation?: string;
  stationReference?: string;
  label?: string;
  town?: string;
  riverName?: string;
  catchmentName?: string;
  gridReference?: string;
  lat?: number | string;
  long?: number | string;
  status?: string;
};

type RawReading = {
  dateTime?: string;
  measure?: string;
  value?: number;
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      ...init.headers,
    },
  });
}

function utcDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateKeysEndingToday(days: number): string[] {
  const today = new Date();
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const offset = days - index - 1;
    return utcDateKey(new Date(midnight - offset * DAY_MS));
  });
}

function sinceForDays(days: number): string {
  return `${dateKeysEndingToday(days)[0]}T00:00:00Z`;
}

function stationIdFromRaw(raw: RawStation): string {
  return raw.stationReference || raw.notation || raw['@id']?.split('/').pop() || '';
}

function normaliseStation(raw: RawStation) {
  const id = stationIdFromRaw(raw);
  if (!id) return null;

  const lat = typeof raw.lat === 'string' ? Number(raw.lat) : raw.lat;
  const lon = typeof raw.long === 'string' ? Number(raw.long) : raw.long;

  return {
    id,
    reference: raw.stationReference || raw.notation || id,
    label: raw.label && raw.label !== 'Rainfall station' ? raw.label : `Rainfall station ${id}`,
    town: raw.town,
    riverName: raw.riverName,
    catchmentName: raw.catchmentName,
    gridReference: raw.gridReference,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    status: raw.status?.split('/').pop(),
  };
}

async function fetchEnvironmentAgency<T>(url: string, cacheSeconds: number): Promise<T> {
  const response = await fetch(url, {
    cf: {
      cacheEverything: true,
      cacheTtl: cacheSeconds,
    },
    headers: {
      accept: 'application/json',
      'user-agent': 'rainfall-dashboard/0.1 (+https://workers.dev)',
    },
  });

  if (!response.ok) {
    throw new Error(`Environment Agency request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

async function handleStations() {
  const url = `${EA_BASE_URL}/id/stations?parameter=rainfall&_limit=10000`;
  const payload = await fetchEnvironmentAgency<{ items?: RawStation[] }>(url, STATION_CACHE_SECONDS);
  const stations = (payload.items || [])
    .map(normaliseStation)
    .filter(Boolean)
    .sort((a, b) => a!.label.localeCompare(b!.label));

  return json(stations, {
    headers: {
      'cache-control': `public, max-age=${STATION_CACHE_SECONDS}`,
    },
  });
}

function buildDailyRainfall(readings: RawReading[], days: number, stationId: string) {
  const dates = dateKeysEndingToday(days);
  const todayKey = dates[dates.length - 1];
  const dailyMap = new Map(
    dates.map((date) => [date, { date, rainfall: 0, readings: 0, isPartial: date === todayKey }]),
  );
  let latestReadingAt: string | undefined;

  for (const reading of readings) {
    if (!reading.dateTime || typeof reading.value !== 'number') continue;
    const date = reading.dateTime.slice(0, 10);
    const bucket = dailyMap.get(date);
    if (!bucket) continue;
    bucket.rainfall += reading.value;
    bucket.readings += 1;
    if (!latestReadingAt || reading.dateTime > latestReadingAt) {
      latestReadingAt = reading.dateTime;
    }
  }

  return {
    stationId,
    days,
    updatedAt: new Date().toISOString(),
    latestReadingAt,
    daily: Array.from(dailyMap.values()).map((day) => ({
      ...day,
      rainfall: Math.round(day.rainfall * 100) / 100,
    })),
  };
}

function stationIdFromMeasure(measure?: string): string | undefined {
  const notation = measure?.split('/').pop();
  return notation?.split('-rainfall-')[0];
}

async function handleMapRainfall() {
  const today = dateKeysEndingToday(1)[0];
  const totals: Record<string, { rainfall: number; readings: number; latestReadingAt?: string }> = {};
  let offset = 0;

  while (offset < 50_000) {
    const upstream = `${EA_BASE_URL}/data/readings?date=${today}&parameter=rainfall&_limit=10000&_offset=${offset}`;
    const payload = await fetchEnvironmentAgency<{ items?: RawReading[] }>(upstream, API_CACHE_SECONDS);
    const items = payload.items || [];
    if (items.length === 0) break;

    for (const reading of items) {
      const stationId = stationIdFromMeasure(reading.measure);
      if (!stationId || typeof reading.value !== 'number') continue;
      const bucket = (totals[stationId] ||= { rainfall: 0, readings: 0 });
      bucket.rainfall += reading.value;
      bucket.readings += 1;
      if (reading.dateTime && (!bucket.latestReadingAt || reading.dateTime > bucket.latestReadingAt)) {
        bucket.latestReadingAt = reading.dateTime;
      }
    }

    if (items.length < 10_000) break;
    offset += 10_000;
  }

  for (const bucket of Object.values(totals)) {
    bucket.rainfall = Math.round(bucket.rainfall * 100) / 100;
  }

  return json(
    {
      date: today,
      updatedAt: new Date().toISOString(),
      totals,
    },
    {
      headers: {
        'cache-control': `public, max-age=${API_CACHE_SECONDS}`,
      },
    },
  );
}

async function handleRainfall(url: URL) {
  const stationId = url.searchParams.get('station') || 'E14920';
  const requestedDays = Number(url.searchParams.get('days') || '14');
  const days = Math.min(Math.max(Number.isFinite(requestedDays) ? requestedDays : 14, 1), 120);

  if (!/^[A-Za-z0-9_-]+$/.test(stationId)) {
    return json({ error: 'Invalid station reference.' }, { status: 400 });
  }

  const upstream = `${EA_BASE_URL}/id/stations/${encodeURIComponent(
    stationId,
  )}/readings?since=${encodeURIComponent(sinceForDays(days))}&parameter=rainfall&_limit=20000`;
  const payload = await fetchEnvironmentAgency<{ items?: RawReading[] }>(upstream, API_CACHE_SECONDS);

  return json(buildDailyRainfall(payload.items || [], days, stationId), {
    headers: {
      'cache-control': `public, max-age=${API_CACHE_SECONDS}`,
    },
  });
}

async function handleApi(request: Request) {
  const url = new URL(request.url);
  try {
    if (request.method === 'OPTIONS') return json({ ok: true });
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, { status: 405 });
    if (url.pathname === '/api/stations') return handleStations();
    if (url.pathname === '/api/map-rainfall') return handleMapRainfall();
    if (url.pathname === '/api/rainfall') return handleRainfall(url);
    return json({ error: 'Not found.' }, { status: 404 });
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : 'Unexpected API error.' }, { status: 502 });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request);
    }
    return env.ASSETS.fetch(request);
  },
};
