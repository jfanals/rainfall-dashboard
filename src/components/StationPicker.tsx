import { useMemo, useState } from 'react';
import type { Station } from '../types';

const MAX_RESULTS = 9;

type StationPickerProps = {
  stations: Station[];
  selectedStation?: Station;
  isLoading: boolean;
  locationEnabled: boolean;
  onSelect: (station: Station) => void;
  onUseLocation: () => void;
};

function searchableText(station: Station): string {
  return [
    station.label,
    station.reference,
    station.town,
    station.riverName,
    station.catchmentName,
    station.gridReference,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function scoreStation(station: Station, query: string): number {
  if (!query) return station.distanceKm ?? 9999;
  const text = searchableText(station);
  const reference = station.reference.toLowerCase();
  const label = station.label.toLowerCase();

  if (reference === query) return -100;
  if (reference.startsWith(query)) return -80;
  if (label.startsWith(query)) return -60;
  if (text.includes(query)) return -20 + (station.distanceKm ?? 0) / 1000;
  return 9999;
}

export function StationPicker({
  stations,
  selectedStation,
  isLoading,
  locationEnabled,
  onSelect,
  onUseLocation,
}: StationPickerProps) {
  const [query, setQuery] = useState('');
  const cleanQuery = query.trim().toLowerCase();

  const results = useMemo(() => {
    return stations
      .map((station) => ({ station, score: scoreStation(station, cleanQuery) }))
      .filter(({ score }) => score < 9999)
      .sort((a, b) => a.score - b.score || a.station.label.localeCompare(b.station.label))
      .slice(0, MAX_RESULTS)
      .map(({ station }) => station);
  }, [stations, cleanQuery]);

  const showNearest = !cleanQuery && locationEnabled;

  return (
    <section className="panel station-picker" aria-labelledby="station-picker-title">
      <div className="panel__heading">
        <div>
          <p className="eyebrow">Monitoring station</p>
          <h2 id="station-picker-title">Choose where to measure</h2>
        </div>
        <button className="ghost-button" type="button" onClick={onUseLocation}>
          {locationEnabled ? 'Location active' : 'Use my location'}
        </button>
      </div>

      <label className="search-box">
        <span>Search by place, river, catchment or station reference</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try Nottingham, Trent, E14920..."
          autoComplete="off"
        />
      </label>

      <div className="station-picker__meta">
        {isLoading ? 'Loading Environment Agency rainfall stations…' : `${stations.length.toLocaleString()} rainfall stations available`}
      </div>

      <div className="station-results" role="list">
        {(results.length ? results : stations.slice(0, MAX_RESULTS)).map((station) => {
          const active = station.id === selectedStation?.id;
          return (
            <button
              key={station.id}
              className={`station-result ${active ? 'station-result--active' : ''}`}
              type="button"
              onClick={() => onSelect(station)}
              role="listitem"
            >
              <span>
                <strong>{station.label}</strong>
                <small>
                  {station.town || station.catchmentName || station.riverName || 'Environment Agency station'} · Ref {station.reference}
                </small>
              </span>
              <span className="station-result__aside">
                {typeof station.distanceKm === 'number' ? `${station.distanceKm.toFixed(1)} km` : active ? 'Selected' : 'Choose'}
              </span>
            </button>
          );
        })}
      </div>

      {showNearest ? <p className="hint">Showing nearest stations first. You can still search by name or reference.</p> : null}
    </section>
  );
}
