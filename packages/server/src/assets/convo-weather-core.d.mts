export interface WeatherSnapshot {
  validAtMs: number;
  current: { temperature: number; apparentTemperature: number | null; weatherTextEn: string };
}
declare const core: {
  CACHE_TTL_MS: number;
  PRESET_CITIES: Array<{ id: string; name: string; label: string; latitude: number; longitude: number }>;
  buildWeatherURL(location: { latitude: number; longitude: number }): string;
  buildGeocodingURL(query: string, koreaOnly?: boolean): string;
  normalizePlaces(value: unknown): Array<{ name: string; label: string; latitude: number; longitude: number }>;
  normalizeWeather(value: unknown, location: object, now?: number): WeatherSnapshot;
  formatSummary(snapshot: WeatherSnapshot): string;
};
export default core;
