/** Geofence helpers shared by the attendance UI. The server repeats every check. */

export type LocationStatus =
  | "verified"
  | "outside"
  | "low_accuracy"
  | "no_location"
  | "no_office";

export type Office = {
  location_id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  require_inside: boolean;
  allow_remote: boolean;
  source: "assigned" | "default";
};

export type GeofenceCheck = {
  status: LocationStatus;
  verified: boolean;
  distance_m?: number | null;
  accuracy_m?: number | null;
  office_name?: string;
  radius_m?: number;
};

/** Great-circle distance in metres (same formula as private.distance_m). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function formatDistance(m: number | null | undefined) {
  if (m === null || m === undefined || !Number.isFinite(Number(m))) return "—";
  const n = Number(m);
  return n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} km`;
}

export const locationStatusLabels: Record<LocationStatus, string> = {
  verified: "Inside geofence",
  outside: "Outside geofence",
  low_accuracy: "Location too imprecise",
  no_location: "Location not shared",
  no_office: "No office assigned",
};

export function locationStatusLabel(status: unknown) {
  return locationStatusLabels[status as LocationStatus] || "Not recorded";
}

/** Readable reason for a browser Geolocation failure. */
export function geolocationError(error: { code?: number; message?: string } | undefined) {
  switch (error?.code) {
    case 1:
      return "Location permission was denied. Allow location access for this site in your browser settings, then try again.";
    case 2:
      return "Your device could not determine its location. Turn on location services (GPS or Wi-Fi) and try again.";
    case 3:
      return "Getting your location took too long. Move to an open area or near a window and try again.";
    default:
      return "Location is not available in this browser. Use a current browser on a device with location services.";
  }
}

/** Hours between two instants, for a live "hours worked" figure. */
export function hoursBetween(from: string | Date, to: string | Date = new Date()) {
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 3600000);
}

export function formatHours(h: number | null | undefined) {
  if (h === null || h === undefined || !Number.isFinite(Number(h))) return "—";
  const minutes = Math.round(Number(h) * 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** OpenStreetMap link opened only when the reviewer clicks it. */
export function mapLink(lat: number, lng: number) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** Embedded map, only when NEXT_PUBLIC_ATTENDANCE_MAP=openstreetmap opts in (coordinates go to OSM). */
export function mapEmbed(lat: number, lng: number) {
  if (process.env.NEXT_PUBLIC_ATTENDANCE_MAP !== "openstreetmap") return null;
  const d = 0.004;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
}
