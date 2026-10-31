// Free weather from Open-Meteo (no API key, works from the browser).

export interface DayWeather {
  date: string;
  min: number;
  max: number;
  rainChance: number;
  code: number;
}
export interface Weather {
  temp: number;
  feels: number;
  code: number;
  wind: number;
  rainChance: number;
  daily: DayWeather[];
  fetchedAt: number;
}

export async function getWeather(lat: number, lon: number): Promise<Weather> {
  const key = `drape.wx.${lat.toFixed(2)},${lon.toFixed(2)}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) || "null") as Weather | null;
    if (hit && Date.now() - hit.fetchedAt < 30 * 60_000) return hit;
  } catch { /* ignore */ }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&hourly=precipitation_probability&forecast_hours=12` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=10&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Weather unavailable");
  const j = await r.json();
  const w: Weather = {
    temp: j.current.temperature_2m,
    feels: j.current.apparent_temperature,
    code: j.current.weather_code,
    wind: j.current.wind_speed_10m,
    rainChance: Math.max(0, ...(j.hourly?.precipitation_probability || [0])),
    daily: j.daily.time.map((d: string, i: number) => ({
      date: d,
      min: j.daily.temperature_2m_min[i],
      max: j.daily.temperature_2m_max[i],
      rainChance: j.daily.precipitation_probability_max[i] ?? 0,
      code: j.daily.weather_code[i],
    })),
    fetchedAt: Date.now(),
  };
  try { localStorage.setItem(key, JSON.stringify(w)); } catch { /* ignore */ }
  return w;
}

export async function searchPlaces(q: string) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en`);
  const j = await r.json();
  return ((j.results || []) as any[]).map((p) => ({
    name: [p.name, p.admin1, p.country].filter(Boolean).join(", "),
    lat: p.latitude as number,
    lon: p.longitude as number,
  }));
}

export function locateMe(): Promise<{ lat: number; lon: number }> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("Location not available"));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), rej, { timeout: 10_000 });
  });
}

export function describe(code: number): { label: string; icon: "sun" | "cloud-sun" | "cloud" | "fog" | "rain" | "snow" | "storm" } {
  if (code === 0) return { label: "Clear", icon: "sun" };
  if (code <= 2) return { label: "Partly cloudy", icon: "cloud-sun" };
  if (code === 3) return { label: "Overcast", icon: "cloud" };
  if (code <= 48) return { label: "Fog", icon: "fog" };
  if (code <= 67 || (code >= 80 && code <= 82)) return { label: "Rain", icon: "rain" };
  if (code <= 77 || code === 85 || code === 86) return { label: "Snow", icon: "snow" };
  return { label: "Storms", icon: "storm" };
}

export const isWet = (code: number, rainChance: number) => rainChance >= 55 || (code >= 51 && code <= 67) || (code >= 80 && code <= 99);

export function fmtTemp(c: number, units: "c" | "f") {
  return units === "f" ? `${Math.round(c * 1.8 + 32)}°` : `${Math.round(c)}°`;
}
