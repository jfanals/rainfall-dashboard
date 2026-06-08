import type { DailyRainfall, MapRainfallSummary, RainfallResponse, Station } from '../types';
import { dateKeysEndingToday, sinceForDays } from './dates';

const EA_BASE_URL = 'https://environment.data.gov.uk/flood-monitoring';
const DEFAULT_STATION_ID = 'E14920';

export { DEFAULT_STATION_ID };

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

function stationIdFromRaw(raw: RawStation): string {
  return raw.stationReference || raw.notation || raw['@id']?.split('/').pop() || '';
}

function normaliseStation(raw: RawStation): Station | null {
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

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function canUseSameOriginApi(): boolean {
  const { hostname, port } = window.location;
  return hostname.endsWith('workers.dev') || port === '8787';
}

async function fetchFromWorker<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!canUseSameOriginApi()) {
    throw new Error('Same-origin Worker API is not available on this host.');
  }
  return fetchJson<T>(path, signal);
}

export type StationQuery = {
  lat: number;
  lon: number;
  distKm: number;
};

export async function fetchStations(query: StationQuery, signal?: AbortSignal): Promise<Station[]> {
  const safeDist = Math.min(Math.max(query.distKm, 1), 120);
  const params = new URLSearchParams({
    lat: String(query.lat),
    lon: String(query.lon),
    dist: String(safeDist),
  });

  try {
    return await fetchFromWorker<Station[]>(`/api/stations?${params}`, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  const url = `${EA_BASE_URL}/id/stations?parameter=rainfall&lat=${encodeURIComponent(query.lat)}&long=${encodeURIComponent(
    query.lon,
  )}&dist=${encodeURIComponent(safeDist)}&_limit=500`;
  const payload = await fetchJson<{ items?: RawStation[] }>(url, signal);
  return (payload.items || [])
    .map(normaliseStation)
    .filter((station): station is Station => Boolean(station))
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0) || a.label.localeCompare(b.label));
}

function buildDailyRainfall(readings: RawReading[], days: number, stationId: string): RainfallResponse {
  const dates = dateKeysEndingToday(days);
  const todayKey = dates[dates.length - 1];
  const dailyMap = new Map<string, DailyRainfall>(
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

function summariseReadings(stationId: string, readings: RawReading[], totals: MapRainfallSummary['totals']) {
  const bucket = (totals[stationId] ||= { rainfall: 0, readings: 0 });
  for (const reading of readings) {
    if (typeof reading.value !== 'number') continue;
    bucket.rainfall += reading.value;
    bucket.readings += 1;
    if (reading.dateTime && (!bucket.latestReadingAt || reading.dateTime > bucket.latestReadingAt)) {
      bucket.latestReadingAt = reading.dateTime;
    }
  }
}

export async function fetchMapRainfall(stationIds: string[], signal?: AbortSignal): Promise<MapRainfallSummary> {
  const uniqueStationIds = [...new Set(stationIds)].slice(0, 200);
  const today = dateKeysEndingToday(1)[0];
  const totals: MapRainfallSummary['totals'] = {};

  if (uniqueStationIds.length === 0) {
    return { date: today, updatedAt: new Date().toISOString(), totals };
  }

  try {
    return await fetchFromWorker<MapRainfallSummary>(
      `/api/map-rainfall?stations=${encodeURIComponent(uniqueStationIds.join(','))}`,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  const queue = [...uniqueStationIds];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length > 0) {
      const stationId = queue.shift();
      if (!stationId || signal?.aborted) return;

      try {
        const url = `${EA_BASE_URL}/id/stations/${encodeURIComponent(stationId)}/readings?date=${today}&parameter=rainfall`;
        const payload = await fetchJson<{ items?: RawReading[] }>(url, signal);
        summariseReadings(stationId, payload.items || [], totals);
      } catch (error) {
        if (signal?.aborted) throw error;
        totals[stationId] ||= { rainfall: 0, readings: 0 };
      }
    }
  });

  await Promise.all(workers);

  for (const bucket of Object.values(totals)) {
    bucket.rainfall = Math.round(bucket.rainfall * 100) / 100;
  }

  return { date: today, updatedAt: new Date().toISOString(), totals };
}

export async function fetchRainfall(
  stationId = DEFAULT_STATION_ID,
  days: number,
  signal?: AbortSignal,
): Promise<RainfallResponse> {
  const safeDays = Math.min(Math.max(days, 1), 120);

  try {
    return await fetchFromWorker<RainfallResponse>(
      `/api/rainfall?station=${encodeURIComponent(stationId)}&days=${safeDays}`,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  const url = `${EA_BASE_URL}/id/stations/${encodeURIComponent(
    stationId,
  )}/readings?since=${encodeURIComponent(sinceForDays(safeDays))}&parameter=rainfall&_limit=20000`;
  const payload = await fetchJson<{ items?: RawReading[] }>(url, signal);
  return buildDailyRainfall(payload.items || [], safeDays, stationId);
}
