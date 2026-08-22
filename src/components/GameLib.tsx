import { useI18n } from "@/i18n";
import type { GameInfo, MatchModeKey } from "@/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";

interface GameLibProps {
  games: GameInfo[];
  modeKey: MatchModeKey;
  onPlay: (gameKey: string, modeKey: MatchModeKey) => void;
}

export default function GameLib({ games, modeKey, onPlay }: GameLibProps) {
  const { t } = useI18n();
  const compatible = games.flatMap((game: GameInfo) => {
    const mode = game.modes.find(({ key }): boolean => key === modeKey);
    return mode ? [{ game, mode }] : [];
  });

  return (
    <section className="library-section">
      <div className="section-heading simplified-heading">
        <h2>{t("library.availableGames")}</h2>
      </div>

      {compatible.length ? (
        <div className="game-grid">
          {compatible.map(({ game, mode }) => {
            const playable: boolean = mode.available && game.models.length > 0;
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
