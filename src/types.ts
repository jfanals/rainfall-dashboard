export type Station = {
  id: string;
  reference: string;
  label: string;
  town?: string;
  riverName?: string;
  catchmentName?: string;
  gridReference?: string;
  lat?: number;
  lon?: number;
  status?: string;
  distanceKm?: number;
};

export type DailyRainfall = {
  date: string;
  rainfall: number;
  readings: number;
  isPartial: boolean;
};

export type RainfallResponse = {
  stationId: string;
  days: number;
  updatedAt: string;
  latestReadingAt?: string;
  daily: DailyRainfall[];
};

export type MapRainfallSummary = {
  date: string;
  updatedAt: string;
  totals: Record<
    string,
    {
      rainfall: number;
      readings: number;
      latestReadingAt?: string;
    }
  >;
};

export type GeoPoint = {
  lat: number;
  lon: number;
};
