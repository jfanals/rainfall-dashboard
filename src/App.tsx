import { useCallback, useEffect, useMemo, useState } from 'react';
import { MetricCard } from './components/MetricCard';
import { RainfallChart } from './components/RainfallChart';
import { StationMap } from './components/StationMap';
import { DEFAULT_STATION_ID, fetchMapRainfall, fetchRainfall, fetchStations } from './lib/environmentAgency';
import { formatDateTime, longDate } from './lib/dates';
import { getBrowserLocation, withDistances } from './lib/geo';
import type { GeoPoint, MapRainfallSummary, RainfallResponse, Station } from './types';

const RANGE_OPTIONS = [7, 14, 30];
const SELECTED_STATION_KEY = 'rainfall-dashboard:selected-station';

function getInitialStationId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('station') || localStorage.getItem(SELECTED_STATION_KEY) || DEFAULT_STATION_ID;
}

function formatMm(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)} mm`;
}

function sumRainfall(days: { rainfall: number }[]) {
  return days.reduce((sum, day) => sum + day.rainfall, 0);
}

function drySpellLength(data: RainfallResponse['daily']) {
  let count = 0;
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const day = data[index];
    if (day.readings === 0 || day.rainfall >= 0.1) break;
    count += 1;
  }
  return count;
}

export default function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStationId, setSelectedStationId] = useState(getInitialStationId);
  const [rangeDays, setRangeDays] = useState(30);
  const [rainfall, setRainfall] = useState<RainfallResponse | null>(null);
  const [mapRainfall, setMapRainfall] = useState<MapRainfallSummary | null>(null);
  const [isStationsLoading, setIsStationsLoading] = useState(true);
  const [isRainfallLoading, setIsRainfallLoading] = useState(false);
  const [isMapRainfallLoading, setIsMapRainfallLoading] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setIsStationsLoading(true);
    fetchStations(controller.signal)
      .then((items) => {
        setStations(items);
        setError(null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load stations.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsStationsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsMapRainfallLoading(true);
    fetchMapRainfall(controller.signal)
      .then((data) => {
        setMapRainfall(data);
        setError(null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load map rainfall.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsMapRainfallLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsRainfallLoading(true);
    fetchRainfall(selectedStationId, rangeDays, controller.signal)
      .then((data) => {
        setRainfall(data);
        setError(null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load rainfall.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsRainfallLoading(false);
      });
    return () => controller.abort();
  }, [selectedStationId, rangeDays]);

  useEffect(() => {
    if (!userLocation || stations.length === 0) return;
    setStations((current) =>
      withDistances(current, userLocation).sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999)),
    );
  }, [userLocation, stations.length]);

  const selectedStation = useMemo(
    () => stations.find((station) => station.id === selectedStationId),
    [stations, selectedStationId],
  );

  const stats = useMemo(() => {
    if (!rainfall?.daily.length) return null;
    const today = rainfall.daily[rainfall.daily.length - 1];
    const last7 = rainfall.daily.slice(-7);
    const total = sumRainfall(rainfall.daily);
    const wettest = rainfall.daily.reduce((max, day) => (day.rainfall > max.rainfall ? day : max), rainfall.daily[0]);
    const daysWithReadings = rainfall.daily.filter((day) => day.readings > 0).length;
    const rainyDays = rainfall.daily.filter((day) => day.rainfall >= 0.2).length;

    return {
      today,
      last7Total: sumRainfall(last7),
      rangeTotal: total,
      average: daysWithReadings ? total / daysWithReadings : 0,
      wettest,
      rainyDays,
      drySpell: drySpellLength(rainfall.daily),
    };
  }, [rainfall]);

  const selectStation = useCallback((station: Station) => {
    setSelectedStationId(station.id);
    setDetailsOpen(true);
    localStorage.setItem(SELECTED_STATION_KEY, station.id);
    const url = new URL(window.location.href);
    url.searchParams.set('station', station.id);
    window.history.replaceState(null, '', url);
  }, []);

  async function useLocation() {
    try {
      const location = await getBrowserLocation();
      setUserLocation(location);
      setLocationEnabled(true);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to use location.');
    }
  }

  return (
    <main className={`map-app ${detailsOpen ? 'map-app--details-open' : ''}`}>
      <StationMap
        stations={stations}
        selectedStation={selectedStation}
        mapRainfall={mapRainfall}
        userLocation={userLocation}
        locationEnabled={locationEnabled}
        isLoading={isStationsLoading}
        isRainfallLoading={isMapRainfallLoading}
        onSelect={selectStation}
        onUseLocation={useLocation}
      />

      {error ? <div className="error-banner map-error" role="alert">{error}</div> : null}

      {detailsOpen ? (
        <aside className="details-panel" aria-label="Selected station rainfall details">
          <button className="details-panel__close" type="button" onClick={() => setDetailsOpen(false)} aria-label="Close details">
            ×
          </button>

          <header className="details-panel__header">
            <p className="eyebrow">Selected station</p>
            <h1>{selectedStation?.label || selectedStationId}</h1>
            <p>{selectedStation ? [selectedStation.town, selectedStation.catchmentName, `Ref ${selectedStation.reference}`].filter(Boolean).join(' · ') : 'Loading station details…'}</p>
          </header>

          <div className="range-buttons range-buttons--compact" role="group" aria-label="Rainfall date range">
            {RANGE_OPTIONS.map((days) => (
              <button
                key={days}
                className={days === rangeDays ? 'range-button range-button--active' : 'range-button'}
                type="button"
                onClick={() => setRangeDays(days)}
              >
                {days}d
              </button>
            ))}
          </div>

          {isRainfallLoading && !rainfall ? <div className="loading-panel">Loading rainfall readings…</div> : null}

          {stats && rainfall ? (
            <>
              <section className="details-summary" aria-label="Brief rainfall summary">
                <MetricCard label="Today" value={formatMm(stats.today.rainfall)} detail={`${stats.today.readings} readings`} tone="blue" />
                <MetricCard label={`${rangeDays}-day total`} value={formatMm(stats.rangeTotal)} detail={`${stats.rainyDays} rain days`} tone="green" />
                <MetricCard label="Wettest" value={formatMm(stats.wettest.rainfall)} detail={longDate(stats.wettest.date)} tone="amber" />
              </section>

              <RainfallChart data={rainfall.daily} />

              <p className="details-note">
                Average {formatMm(stats.average)} per observed day · latest reading {formatDateTime(rainfall.latestReadingAt)}
                {isRainfallLoading ? ' · refreshing…' : ''}
              </p>
            </>
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}
