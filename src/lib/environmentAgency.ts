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

async function fetchFromWorker<T>(path: string, signal?: AbortSignal): Promise<T> {
  return fetchJson<T>(path, signal);
}

export async function fetchStations(signal?: AbortSignal): Promise<Station[]> {
  try {
    return await fetchFromWorker<Station[]>('/api/stations', signal);
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  const url = `${EA_BASE_URL}/id/stations?parameter=rainfall&_limit=10000`;
  const payload = await fetchJson<{ items?: RawStation[] }>(url, signal);
  return (payload.items || [])
    .map(normaliseStation)
    .filter((station): station is Station => Boolean(station))
    .sort((a, b) => a.label.localeCompare(b.label));
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

export async function fetchMapRainfall(signal?: AbortSignal): Promise<MapRainfallSummary> {
  try {
    return await fetchFromWorker<MapRainfallSummary>('/api/map-rainfall', signal);
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  const today = dateKeysEndingToday(1)[0];
  const totals: MapRainfallSummary['totals'] = {};
  let offset = 0;

  while (offset < 50_000) {
    const url = `${EA_BASE_URL}/data/readings?date=${today}&parameter=rainfall&_limit=10000&_offset=${offset}`;
    const payload = await fetchJson<{ items?: RawReading[] }>(url, signal);
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
