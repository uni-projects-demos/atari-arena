import { type JSX, useLayoutEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import { modeSides } from "@/lib/modes";
import type { GameInfo, MatchMode, MatchModeKey, MatchSide, PlayerSlot } from "@/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";

interface GameLibProps {
  games: GameInfo[];
  modeKey: MatchModeKey;
  onPlay: (gameKey: string, modeKey: MatchModeKey) => void;
}

const MATCH_BADGES: readonly { code: string; left: MatchSide; right: MatchSide }[] = [
  { code: "MvG", left: "model", right: "game" },
  { code: "UvG", left: "user", right: "game" },
  { code: "UvM", left: "user", right: "model" },
  { code: "MvM", left: "model", right: "model" },
];

function matchBadge(mode: MatchMode): string | null {
  const { left, right } = modeSides(mode);
  if ((left === "model" && right === "game") || (left === "game" && right === "model")) {
    return "MvG";
  }
  if ((left === "user" && right === "game") || (left === "game" && right === "user")) {
    return "UvG";
  }
  if ((left === "user" && right === "model") || (left === "model" && right === "user")) {
    return "UvM";
  }
  if (left === "model" && right === "model") return "MvM";
  return null;
}

function FittedGameTitle({ text }: { text: string }): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect((): (() => void) | undefined => {
    const wrapper: HTMLDivElement | null = wrapperRef.current;
    const title: HTMLElement | null = wrapper?.querySelector(".game-card-title") ?? null;
    if (!wrapper || !title || !text) return;

    let isMounted = true;
    const fit: () => void = (): void => {
      if (!isMounted) return;
      title.style.fontSize = "";
      const maxSize: number = Number.parseFloat(getComputedStyle(title).fontSize);
      if (
        !Number.isFinite(maxSize) ||
        !wrapper.clientWidth ||
        title.scrollWidth <= wrapper.clientWidth
      ) {
        return;
      }

      let low = 1;
      let high = maxSize;
      for (let i = 0; i < 12; i += 1) {
        const mid: number = (low + high) / 2;
        title.style.fontSize = `${mid}px`;
        if (title.scrollWidth > wrapper.clientWidth) high = mid;
        else low = mid;
      }
      title.style.fontSize = `${low}px`;
    };

    const observer = new ResizeObserver(fit);
    observer.observe(wrapper);
    fit();
    void document.fonts?.ready.then(fit);
    return (): void => {
      isMounted = false;
      observer.disconnect();
    };
  }, [text]);

  return (
    <div ref={wrapperRef} className="game-card-title-fit">
      <CardTitle className="game-card-title" title={text}>
        {text}
      </CardTitle>
    </div>
  );
}

export default function GameLib({ games, modeKey, onPlay }: GameLibProps): JSX.Element {
  const { t } = useI18n();
  const compatible: { game: GameInfo; mode: MatchMode }[] = games.flatMap(
    (game: GameInfo): { game: GameInfo; mode: MatchMode }[] => {
      const mode: MatchMode | undefined = game.modes.find(
        ({ key }: MatchMode): boolean => key === modeKey,
      );
      return mode ? [{ game, mode }] : [];
    },
  );

  return (
    <section className="library-section">
      <div className="section-heading simplified-heading">
        <h2>{t("library.availableGames")}</h2>
      </div>

      {compatible.length ? (
        <div className="game-grid">
          {compatible.map(({ game, mode }: { game: GameInfo; mode: MatchMode }): JSX.Element => {
            const needsModel: boolean = mode.players
              ? mode.players.some(({ player_type }: PlayerSlot): boolean => player_type === "model")
              : mode.left_label.toLowerCase().includes("model") ||
                mode.right_label.toLowerCase().includes("model");
            const playable: boolean = mode.available && (!needsModel || game.models.length > 0);
            const label: string = t(`games.${game.key}.label`, undefined, game.label);
            const supportedBadges: Set<string | null> = new Set(
              game.modes.filter((entry: MatchMode): boolean => entry.available).map(matchBadge),
            );

            return (
              <Card
                key={game.key}
                data-game={game.key}
                className={playable ? "game-card" : "game-card is-disabled"}
              >
                <CardHeader>
                  <div className="game-card-top">
                    <fieldset className="game-mode-badges">
                      <legend className="sr-only">{t("mode.title")}</legend>
                      {MATCH_BADGES.filter(({ code }): boolean => supportedBadges.has(code)).map(
                        ({ code, left, right }): JSX.Element => (
                          <Badge
                            key={code}
                            className="game-mode-badge"
                            title={`${t(`mode.${left}`)} ${t("mode.vs")} ${t(`mode.${right}`)}`}
                          >
                            {code[0]}
                            <span className="game-mode-badge-v">v</span>
                            {code[2]}
                          </Badge>
                        ),
                      )}
                    </fieldset>

                    {!playable && <Badge variant="destructive">{t("library.unavailable")}</Badge>}
                  </div>

                  <FittedGameTitle text={label.replace(/^Atari\s+/i, "")} />
                </CardHeader>

                <CardFooter>
                  <Button
                    type="button"
                    className="wide"
                    disabled={!playable}
                    onClick={(): void => onPlay(game.key, modeKey)}
                  >
                    {t("library.play")}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="empty-card">
          <CardContent>{t("library.noCompatibleGames")}</CardContent>
        </Card>
      )}
    </section>
  );
}
