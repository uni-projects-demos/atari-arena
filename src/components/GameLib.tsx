import type React from "react";
import { useI18n } from "@/i18n";
import type { GameInfo, MatchMode, MatchModeKey, PlayerSlot } from "@/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";

interface GameLibProps {
  games: GameInfo[];
  modeKey: MatchModeKey;
  onPlay: (gameKey: string, modeKey: MatchModeKey) => void;
}

export default function GameLib({ games, modeKey, onPlay }: GameLibProps): React.JSX.Element {
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
          {compatible.map(
            ({ game, mode }: { game: GameInfo; mode: MatchMode }): React.JSX.Element => {
              const needsModel: boolean = mode.players
                ? mode.players.some(
                    ({ player_type }: PlayerSlot): boolean => player_type === "model",
                  )
                : mode.left_label.toLowerCase().includes("model") ||
                  mode.right_label.toLowerCase().includes("model");
              const playable: boolean = mode.available && (!needsModel || game.models.length > 0);
              const label: string = t(`games.${game.key}.label`, undefined, game.label);
              const description: string = t(
                `games.${game.key}.description`,
                undefined,
                game.description || t("library.registeredGamePlugin"),
              );

              return (
                <Card key={game.key} className={playable ? "game-card" : "game-card is-disabled"}>
                  <CardHeader>
                    <div className="game-card-top">
                      <span className="game-glyph" aria-hidden="true">
                        {label.replace(/^Atari\s+/i, "")}
                      </span>

                      {!playable && <Badge variant="destructive">{t("library.unavailable")}</Badge>}
                    </div>

                    <CardTitle>{label}</CardTitle>

                    <CardDescription>{description}</CardDescription>
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
            },
          )}
        </div>
      ) : (
        <Card className="empty-card">
          <CardContent>{t("library.noCompatibleGames")}</CardContent>
        </Card>
      )}
    </section>
  );
}
