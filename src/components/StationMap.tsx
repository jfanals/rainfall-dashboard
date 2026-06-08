import { useEffect, useMemo, useRef, useState } from 'react';
import L, { type CircleMarker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchMapRainfall, fetchRainfall, fetchStations } from '../lib/environmentAgency';
import type { GeoPoint, MapRainfallSummary, RainfallResponse, Station } from '../types';

type StationMapProps = {
  stations: Station[];
  selectedStation?: Station;
  mapRainfall?: MapRainfallSummary | null;
  userLocation?: GeoPoint | null;
  locationEnabled: boolean;
  onSelect: (station: Station) => void;
  onUseLocation: () => void;
  onStationsChange: (stations: Station[]) => void;
  onMapRainfallChange: (rainfall: MapRainfallSummary) => void;
  onError: (message: string | null) => void;
};

type MappedStation = Station & { lat: number; lon: number };

const INITIAL_CENTRE: L.LatLngExpression = [50.691845, -1.308358];
const REGION_ZOOM = 10;

const baseMarkerStyle: L.CircleMarkerOptions = {
  radius: 5,
  stroke: true,
  color: '#0369a1',
  weight: 1,
  fillColor: '#38bdf8',
  fillOpacity: 0.72,
};

const selectedMarkerStyle: L.CircleMarkerOptions = {
  stroke: true,
  weight: 5,
};

function hasMapCoordinates(station?: Station): station is MappedStation {
  return typeof station?.lat === 'number' && typeof station.lon === 'number';
}

function stationSummary(station: Station): string {
  return [station.town, station.catchmentName, station.riverName, `Ref ${station.reference}`].filter(Boolean).join(' · ');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function rainStyle(rainfall = 0): L.CircleMarkerOptions {
  const radius = rainfall <= 0 ? 4 : Math.min(22, 6 + Math.sqrt(rainfall) * 4.2);
  if (rainfall >= 20) return { ...baseMarkerStyle, radius, color: '#7f1d1d', fillColor: '#ef4444', fillOpacity: 0.9 };
  if (rainfall >= 10) return { ...baseMarkerStyle, radius, color: '#7c2d12', fillColor: '#f97316', fillOpacity: 0.88 };
  if (rainfall >= 5) return { ...baseMarkerStyle, radius, color: '#581c87', fillColor: '#a855f7', fillOpacity: 0.84 };
  if (rainfall >= 1) return { ...baseMarkerStyle, radius, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.8 };
  if (rainfall > 0) return { ...baseMarkerStyle, radius, color: '#0284c7', fillColor: '#38bdf8', fillOpacity: 0.76 };
  return { ...baseMarkerStyle, radius, color: '#64748b', fillColor: '#cbd5e1', fillOpacity: 0.48 };
}

function selectedStyle(rainfall = 0): L.CircleMarkerOptions {
  const style = rainStyle(rainfall);
  return { ...style, ...selectedMarkerStyle, radius: Math.max(13, style.radius as number) };
}

function formatMm(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)} mm`;
}

function miniChart(data: RainfallResponse): string {
  const max = Math.max(1, ...data.daily.map((day) => day.rainfall));
  return data.daily
    .map((day) => {
      const height = Math.max(day.rainfall > 0 ? 2 : 1, Math.round((day.rainfall / max) * 34));
      return `<span class="mini-chart__bar" style="height:${height}px" title="${day.date}: ${formatMm(day.rainfall)}"></span>`;
    })
    .join('');
}

function tooltipContent(station: Station, todayRainfall = 0, details?: RainfallResponse): string {
  const total7 = details?.daily.reduce((sum, day) => sum + day.rainfall, 0) ?? 0;
  const summary = stationSummary(station);

  return `
    <div class="station-tooltip-card">
      <strong>${escapeHtml(station.label)}</strong>
      <span>${escapeHtml(summary)}</span>
      <div class="station-tooltip-card__today">Today: <b>${formatMm(todayRainfall)}</b></div>
      ${
        details
          ? `<div class="mini-chart" aria-hidden="true">${miniChart(details)}</div><small>Last 7 days: ${formatMm(total7)} · tap for details</small>`
          : '<div class="mini-chart mini-chart--loading">Loading 7-day chart…</div><small>Tap for details</small>'
      }
    </div>
  `;
}

function visibleStationQuery(map: L.Map) {
  const center = map.getCenter();
  const bounds = map.getBounds();
  const radiusKm = Math.min(120, Math.max(3, center.distanceTo(bounds.getNorthEast()) / 1000));

  return {
    lat: Number(center.lat.toFixed(5)),
    lon: Number(center.lng.toFixed(5)),
    distKm: Math.ceil(radiusKm),
  };
}

export function StationMap({
  stations,
  selectedStation,
  mapRainfall,
  userLocation,
  locationEnabled,
  onSelect,
  onUseLocation,
  onStationsChange,
  onMapRainfallChange,
  onError,
}: StationMapProps) {
  const [isLoadingVisibleStations, setIsLoadingVisibleStations] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const markerMapRef = useRef<Map<string, CircleMarker>>(new Map());
  const hoverCacheRef = useRef<Map<string, RainfallResponse>>(new Map());
  const loadAbortRef = useRef<AbortController | null>(null);
  const lastQueryKeyRef = useRef('');

  const mappedStations = useMemo(() => stations.filter(hasMapCoordinates), [stations]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: INITIAL_CENTRE,
      zoom: REGION_ZOOM,
      preferCanvas: true,
      scrollWheelZoom: true,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    async function loadVisibleStations() {
      const query = visibleStationQuery(map);
      const queryKey = `${query.lat}:${query.lon}:${query.distKm}`;
      if (queryKey === lastQueryKeyRef.current) return;
      lastQueryKeyRef.current = queryKey;

      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      setIsLoadingVisibleStations(true);

      try {
        const visibleStations = await fetchStations(query, controller.signal);
        onStationsChange(visibleStations);
        if (!controller.signal.aborted) setIsLoadingVisibleStations(false);

        const rainfall = await fetchMapRainfall(visibleStations.map((station) => station.id), controller.signal);
        onMapRainfallChange(rainfall);
        onError(null);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setIsLoadingVisibleStations(false);
          onError(cause instanceof Error ? cause.message : 'Unable to load visible stations.');
        }
      }
    }

    let debounce: number | undefined;
    const scheduleLoad = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(loadVisibleStations, 220);
    };

    layerRef.current = L.layerGroup().addTo(map);
    userLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    map.on('moveend zoomend', scheduleLoad);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      scheduleLoad();
    });
    resizeObserver.observe(containerRef.current);
    setTimeout(() => {
      map.invalidateSize();
      loadVisibleStations();
    }, 0);

    return () => {
      loadAbortRef.current?.abort();
      window.clearTimeout(debounce);
      resizeObserver.disconnect();
      map.off('moveend zoomend', scheduleLoad);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      userLayerRef.current = null;
      markerMapRef.current.clear();
    };
  }, [onError, onMapRainfallChange, onStationsChange]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    layer.clearLayers();
    markerMapRef.current.clear();

    for (const station of mappedStations) {
      const todayRainfall = mapRainfall?.totals[station.id]?.rainfall ?? 0;
      const marker = L.circleMarker(
        [station.lat, station.lon],
        station.id === selectedStation?.id ? selectedStyle(todayRainfall) : rainStyle(todayRainfall),
      )
        .bindTooltip(tooltipContent(station, todayRainfall, hoverCacheRef.current.get(station.id)), {
          className: 'station-tooltip',
          direction: 'top',
          offset: [0, -10],
          opacity: 0.98,
        })
        .on('mouseover', () => {
          const cached = hoverCacheRef.current.get(station.id);
          marker.setTooltipContent(tooltipContent(station, todayRainfall, cached));
          if (cached) return;

          fetchRainfall(station.id, 7)
            .then((details) => {
              hoverCacheRef.current.set(station.id, details);
              marker.setTooltipContent(tooltipContent(station, todayRainfall, details));
            })
            .catch(() => {
              marker.setTooltipContent(tooltipContent(station, todayRainfall));
            });
        })
        .on('click', () => {
          onSelect(station);
        });

      marker.addTo(layer);
      markerMapRef.current.set(station.id, marker);
    }
  }, [mappedStations, mapRainfall, onSelect, selectedStation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const [stationId, marker] of markerMapRef.current) {
      const todayRainfall = mapRainfall?.totals[stationId]?.rainfall ?? 0;
      marker.setStyle(stationId === selectedStation?.id ? selectedStyle(todayRainfall) : rainStyle(todayRainfall));
      if (stationId === selectedStation?.id) marker.bringToFront();
    }
  }, [mapRainfall, selectedStation]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = userLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    if (userLocation) {
      L.circleMarker([userLocation.lat, userLocation.lon], {
        radius: 9,
        color: '#0f172a',
        weight: 3,
        fillColor: '#ffffff',
        fillOpacity: 1,
      })
        .bindTooltip('Your approximate location', { direction: 'top' })
        .addTo(layer);

      map.setView([userLocation.lat, userLocation.lon], Math.max(map.getZoom(), REGION_ZOOM), { animate: true });
    }
  }, [userLocation]);

  return (
    <section className="panel map-panel map-panel--primary" aria-label="Rainfall map">
      <button className="target-button" type="button" onClick={onUseLocation} aria-label="Use my location" title="Use my location">
        {locationEnabled ? '◎' : '⌖'}
      </button>

      {isLoadingVisibleStations ? <div className="map-loading-pill">Loading visible stations…</div> : null}

      <div className="station-map" aria-label="Map of rainfall monitoring stations coloured by today’s rainfall">
        <div ref={containerRef} className="station-map__canvas" />
        <div className="map-legend" aria-hidden="true">
          <span><i className="legend-dot legend-dot--dry" />0 mm</span>
          <span><i className="legend-dot legend-dot--light" />0–1</span>
          <span><i className="legend-dot legend-dot--moderate" />1–5</span>
          <span><i className="legend-dot legend-dot--heavy" />5–10</span>
          <span><i className="legend-dot legend-dot--very-heavy" />10+ mm</span>
        </div>
      </div>
    </section>
  );
}
