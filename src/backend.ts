import fbCatalog from "./data/fb-games.json";
import type { ResCatalog } from "./types";

interface Catalog {
  info: ResCatalog;
  isBackEndAvailable: boolean;
}

const fallback: ResCatalog = fbCatalog as ResCatalog;

const norm = (url: string = ""): string => url.trim().replace(/\/+$/, "");
const url = (base: string, path: string): string =>
  `${base}${path.startsWith("/") ? path : `/${path}`}`;

export const urlAPI = (path: string): string => url(norm(import.meta.env.API_URL), path);
export const urlWebSocket = (path: string): string =>
  url(norm(import.meta.env.WS_URL) || location.origin.replace(/^http/, "ws"), path);

export async function loadCatalog(): Promise<Catalog> {
  try {
    const res: Response = await fetch(urlAPI("/api/info"));
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const info: ResCatalog = (await res.json()) as ResCatalog;
    return { info, isBackEndAvailable: true };
  } catch {
    return { info: fallback, isBackEndAvailable: false };
  }
}
