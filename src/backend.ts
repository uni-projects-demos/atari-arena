import type { BrowserRuntime, GameSocket } from "@atari-arena/browser";
import fbCatalog from "./data/fb-games.json";
import { alphabeticalCatalog } from "./lib/catalog";
import type { ResCatalog } from "./types";

export type { GameSocket } from "@atari-arena/browser";

const isBrowser: boolean = import.meta.env.VITE_RUNTIME === "browser";
export const modelFileAccept: string = isBrowser ? ".onnx" : ".pt,.pth,.zip";
let browserRuntime: Promise<BrowserRuntime> | null = null;
let loadedRuntime: BrowserRuntime | null = null;
function localRuntime(): Promise<BrowserRuntime> {
  browserRuntime ??= import("@atari-arena/browser").then(({ BrowserRuntime }) => {
    const base = new URL(`${import.meta.env.BASE_URL}runtime/`, location.origin);
    const runtime = new BrowserRuntime({
      manifestUrl: new URL("games.json", base).href,
      wasmUrl: new URL("arena_wasm.js", base).href,
      ortUrl: new URL("ort/", base).href,
      executionProvider: import.meta.env.VITE_BROWSER_DEVICE === "webgpu" ? "webgpu" : "wasm",
    });
    loadedRuntime = runtime;
    return runtime;
  });
  return browserRuntime;
}

interface Catalog {
  info: ResCatalog;
  isBackEndAvailable: boolean;
}

const fallback: ResCatalog = alphabeticalCatalog(fbCatalog as ResCatalog);

const norm: (url?: string) => string = (url: string = ""): string => url.trim().replace(/\/+$/, "");
const url: (base: string, path: string) => string = (base: string, path: string): string =>
  `${base}${path.startsWith("/") ? path : `/${path}`}`;

export const urlAPI: (path: string) => string = (path: string): string =>
  url(norm(import.meta.env.VITE_API_URL), path);
export const urlWebSocket: (path: string) => string = (path: string): string =>
  url(norm(import.meta.env.VITE_WS_URL) || location.origin.replace(/^http/, "ws"), path);

export async function requestAPI(path: string, init?: RequestInit): Promise<Response> {
  return isBrowser ? (await localRuntime()).request(path, init) : fetch(urlAPI(path), init);
}
export function openGameSocket(): GameSocket {
  if (!isBrowser) return new WebSocket(urlWebSocket("/ws/play"));
  if (!loadedRuntime) throw new Error("Browser runtime catalog has not loaded");
  return loadedRuntime.openSocket();
}

export async function loadCatalog(): Promise<Catalog> {
  try {
    const res: Response = await requestAPI("/api/info");
    if (!res.ok) {
      return { info: fallback, isBackEndAvailable: false };
    }

    const info: ResCatalog = (await res.json()) as ResCatalog;
    return { info: alphabeticalCatalog(info), isBackEndAvailable: true };
  } catch {
    return { info: fallback, isBackEndAvailable: false };
  }
}
