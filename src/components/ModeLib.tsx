import { useI18n } from "@/i18n";
import type { MatchModeKey, ModeCatalog } from "@/types";
import { Button } from "./ui/button";

interface ModeLibProps {
  modes: ModeCatalog[];
  selected: MatchModeKey;
  onSelect: (mode: MatchModeKey) => void;
}

export default function ModeLib({ modes, selected, onSelect }: ModeLibProps) {
  const { t } = useI18n();

  return (
    <section className="library-section library-mode-section">
      <div className="section-heading simplified-heading">
        <h2>{t("mode.modelVs")}</h2>
      </div>

      <fieldset className="mode-grid mode-grid-toggle" aria-label={t("mode.modelVersus")}>
        <legend className="sr-only">{t("mode.modelVersus")}</legend>
        {modes.map(({ key }: ModeCatalog) => {
          const isSelected: boolean = key === selected;
          return (
            <Button
              key={key}
              type="button"
              variant={isSelected ? "default" : "outline"}
              className={`mode-tile mode-tile-compact${isSelected ? " is-selected" : ""}`}
              onClick={(): void => onSelect(key)}
              aria-pressed={isSelected}
            >
              {t(key === "user" ? "mode.user" : "mode.game")}
            </Button>
          );
        })}
      </fieldset>
    </section>
  );
}
