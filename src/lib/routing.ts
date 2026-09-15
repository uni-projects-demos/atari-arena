import type { MatchModeKey } from "@/types";

export const DEFAULT_MODE: MatchModeKey = "user";

const IS_PAGES_ROUTING: boolean = import.meta.env.MODE === "pages";

export interface RouteState {
  gameKey: string | null;
  modeKey: MatchModeKey;
}

function asModeKey(value: string | null): MatchModeKey | null {
  const normalized: string = value?.trim() ?? "";
  return normalized || null;
}

export function buildURL(gameKey: string | null, modeKey: MatchModeKey): string {
  const route: string = `${gameKey ? `/play/${encodeURIComponent(gameKey)}` : "/"}?mode=${encodeURIComponent(modeKey)}`;
  return IS_PAGES_ROUTING ? `#${route}` : route;
}

export function routeFromLoc(): RouteState {
  const raw: string = IS_PAGES_ROUTING
    ? location.hash.slice(1) || "/"
    : `${location.pathname}${location.search}`;
  const url: URL = new URL(raw, location.origin);
  const match: RegExpMatchArray | null = url.pathname.match(/^\/play\/([^/]+)\/?$/);
  return {
    gameKey: match ? decodeURIComponent(match[1]) : null,
    modeKey: asModeKey(url.searchParams.get("mode")) ?? DEFAULT_MODE,
  };
}
