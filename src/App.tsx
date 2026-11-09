import { type JSX, useEffect, useState } from "react";
import { loadCatalog } from "./backend";
import Header from "./components/Header";
import { useI18n } from "./i18n";
import { fetchCatalog } from "./lib/api";
import { modeSides } from "./lib/modes";
import { buildURL, DEFAULT_MODE, type RouteState, routeFromLoc } from "./lib/routing";
import ArenaPage from "./pages/ArenaPage";
import LandingPage from "./pages/LandingPage";
import type {
  GameInfo,
  MatchMode,
  MatchModeKey,
  MatchSide,
  ModeCatalog,
  ResCatalog,
} from "./types";

function buildCatalogModes(games: GameInfo[]): ModeCatalog[] {
  const counts: Map<MatchModeKey, number> = new Map<MatchModeKey, number>();
  for (const game of games) {
    for (const mode of game.modes) {
      counts.set(mode.key, (counts.get(mode.key) ?? 0) + Number(mode.available));
    }
  }
  return Array.from(counts, ([key, playableGames]: [MatchModeKey, number]): ModeCatalog => {
    const representative: MatchMode | undefined = games
      .flatMap((game: GameInfo): MatchMode[] => game.modes)
      .find((mode: MatchMode): boolean => mode.key === key);
    const sides: { left: MatchSide; right: MatchSide } = representative
      ? modeSides(representative)
      : key === "user"
        ? { left: "user" as const, right: "model" as const }
        : key === "user-game"
          ? { left: "user" as const, right: "game" as const }
          : key === "model"
            ? { left: "model" as const, right: "model" as const }
            : key === "model-user"
              ? { left: "model" as const, right: "user" as const }
              : key === "user-model"
                ? { left: "user" as const, right: "model" as const }
                : { left: "model" as const, right: "game" as const };
    return { key, playableGames, ...sides };
  });
}

export default function App(): JSX.Element {
  const { t } = useI18n();
  const [info, setInfo] = useState<ResCatalog | null>(null);
  const [isBackEndAvailable, setIsBackEndAvailable] = useState(false);
  const [arenaRunning, setArenaRunning] = useState(false);
  const [route, setRoute] = useState<RouteState>(routeFromLoc);
  const activeGame: GameInfo | null =
    info && route.gameKey
      ? (info.games.find(({ key }: GameInfo): boolean => key === route.gameKey) ?? null)
      : null;
  const gameLabelKey: string | undefined =
    activeGame?.key === "ice_hockey" ? "icehockey" : activeGame?.key;
  const pageTitle: string = activeGame
    ? t(`games.${gameLabelKey}.label`, undefined, activeGame.label)
    : t("app.title");
  const tabTitle: string = activeGame
    ? t("seo.tab.game", { game: pageTitle, app: t("app.title") }, `${pageTitle} | Atari Arena`)
    : t("seo.tab.home", undefined, "Atari Arena | Eval & play models");

  useEffect((): void => {
    document.title = tabTitle;
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", tabTitle);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", tabTitle);
  }, [tabTitle]);

  useEffect((): void => {
    document.documentElement.dataset.game = activeGame?.key ?? "home";
    const background = getComputedStyle(document.documentElement)
      .getPropertyValue("--page-background")
      .trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  }, [activeGame?.key]);

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

  const nav: (gameKey: string | null, modeKey: MatchModeKey, isReplace?: boolean) => void = (
    gameKey: string | null,
    modeKey: MatchModeKey,
    isReplace: boolean = false,
  ): void => {
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
    <main
      className="backend-shell"
      data-view={activeGame ? "game" : "home"}
      data-game={activeGame?.key ?? "home"}
    >
      <header className="backend-header">
        <div className="backend-header-copy">
          <h1>{pageTitle}</h1>
        </div>

        <Header activeGame={Boolean(activeGame)} arenaRunning={arenaRunning} onBack={back} />
      </header>

      {activeGame ? (
        <ArenaPage
          key={`${activeGame.key}:${route.modeKey}`}
          game={activeGame}
          requestedMode={route.modeKey}
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
