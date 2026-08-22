import { useEffect, useState } from "react";
import { loadCatalog } from "./backend";
import Header, { type ThemeMode } from "./components/Header";
import { useI18n } from "./i18n";
import { fetchCatalog } from "./lib/api";
import { buildURL, DEFAULT_MODE, type RouteState, routeFromLoc } from "./lib/routing";
import ArenaPage from "./pages/ArenaPage";
import LandingPage from "./pages/LandingPage";
import type { GameInfo, MatchModeKey, ModeCatalog, ResCatalog } from "./types";

const STORAGE_KEY: string = "ui-theme";

function initialTheme(): ThemeMode {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function buildCatalogModes(games: GameInfo[]): ModeCatalog[] {
  const counts: Map<MatchModeKey, number> = new Map<MatchModeKey, number>();
  for (const game of games) {
    for (const mode of game.modes) {
      counts.set(mode.key, (counts.get(mode.key) ?? 0) + Number(mode.available));
    }
  }
  return Array.from(counts, ([key, playableGames]: [MatchModeKey, number]) => ({
    key,
    playableGames,
  }));
}

export default function App() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [info, setInfo] = useState<ResCatalog | null>(null);
  const [isBackEndAvailable, setIsBackEndAvailable] = useState(false);
  const [arenaRunning, setArenaRunning] = useState(false);
  const [route, setRoute] = useState<RouteState>(routeFromLoc);
  const activeGame: GameInfo | null =
    info && route.gameKey
      ? (info.games.find(({ key }: GameInfo): boolean => key === route.gameKey) ?? null)
      : null;
  const pageTitle: string = activeGame
    ? t(`games.${activeGame.key}.label`, undefined, activeGame.label)
    : t("app.title");

  useEffect((): void => {
    document.title = pageTitle;
  }, [pageTitle]);

  useEffect((): void => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#09090b" : "#f4f4f5");
  }, [theme]);

  useEffect((): (() => void) => {
    const syncRoute: () => void = (): void => setRoute(routeFromLoc());
    window.addEventListener("popstate", syncRoute);
    return (): void => {
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);

  useEffect((): void => {
    void loadCatalog().then((result): void => {
      setInfo(result.info);
      setIsBackEndAvailable(result.isBackEndAvailable);
    });
  }, []);

  const refreshInfo: () => Promise<ResCatalog> = async (): Promise<ResCatalog> => {
    const next: ResCatalog = await fetchCatalog((status: number): string =>
      t("app.catalogRequestFailed", { status }),
    );
    setInfo(next);
    return next;
  };

  const nav = (gameKey: string | null, modeKey: MatchModeKey, isReplace: boolean = false): void => {
    const nxt: RouteState = { gameKey, modeKey };
    const url: string = buildURL(gameKey, modeKey);
    if (isReplace) {
      history.replaceState(nxt, "", url);
    } else {
      history.pushState(nxt, "", url);
    }
    setRoute(nxt);
  };

  if (!info) {
    return (
      <main className="backend-shell loading">
        <div className="loading-orb" />
        <p>{t("app.loadingGames")}</p>
      </main>
    );
  }

  const modes: ModeCatalog[] = buildCatalogModes(info.games);
  const selectedMode: MatchModeKey =
    modes.find(({ key }: ModeCatalog): boolean => key === route.modeKey)?.key ??
    modes.find(({ key }: ModeCatalog): boolean => key === DEFAULT_MODE)?.key ??
    modes[0]?.key ??
    DEFAULT_MODE;
  const back: () => void = (): void => nav(null, route.modeKey);

  return (
    <main className="backend-shell">
      <header className="backend-header">
        <div className="backend-header-copy">
          <h1>{pageTitle}</h1>

          {!activeGame && <p className="muted header-copy">{t("app.subtitle")}</p>}
        </div>

        <Header
          theme={theme}
          activeGame={Boolean(activeGame)}
          arenaRunning={arenaRunning}
          onBack={back}
          onToggleTheme={(): void =>
            setTheme((current: ThemeMode): "dark" | "light" =>
              current === "dark" ? "light" : "dark",
            )
          }
        />
      </header>

      {activeGame ? (
        <ArenaPage
          key={`${activeGame.key}:${route.modeKey}`}
          game={activeGame}
          requestedMode={route.modeKey}
          onBack={back}
          onCatalogRefresh={refreshInfo}
          isBackEndAvailable={isBackEndAvailable}
          onRunningChange={setArenaRunning}
        />
      ) : (
        <LandingPage
          games={info.games}
          modes={modes}
          selectedMode={selectedMode}
          onMode={(modeKey: MatchModeKey): void => nav(null, modeKey, true)}
          onPlay={(gameKey: string, modeKey: MatchModeKey): void => nav(gameKey, modeKey)}
        />
      )}
    </main>
  );
}
