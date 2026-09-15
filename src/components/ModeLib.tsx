import type React from "react";
import { useI18n } from "@/i18n";
import { sideLabelKey, sortSides } from "@/lib/modes";
import type { MatchModeKey, MatchSide, ModeCatalog } from "@/types";

interface ModeLibProps {
  modes: ModeCatalog[];
  selected: MatchModeKey;
  onSelect: (mode: MatchModeKey) => void;
}

export default function ModeLib({ modes, selected, onSelect }: ModeLibProps): React.JSX.Element {
  const { t } = useI18n();
  const selectedMode: ModeCatalog | undefined =
    modes.find(({ key }: ModeCatalog): boolean => key === selected) ?? modes[0];
  const leftOptions: MatchSide[] = sortSides(modes.map(({ left }: ModeCatalog): MatchSide => left));
  const selectedLeft: MatchSide = selectedMode?.left ?? leftOptions[0] ?? "model";
  const rightModes: ModeCatalog[] = modes.filter(
    ({ left }: ModeCatalog): boolean => left === selectedLeft,
  );
  const rightOptions: MatchSide[] = sortSides(
    rightModes.map(({ right }: ModeCatalog): MatchSide => right),
    "right",
  );
  const selectedRight: MatchSide = selectedMode?.right ?? rightOptions[0] ?? "model";

  const chooseLeft: (left: MatchSide) => void = (left: MatchSide): void => {
    const next: ModeCatalog | undefined =
      modes.find(
        (entry: ModeCatalog): boolean => entry.left === left && entry.right === selectedRight,
      ) ?? modes.find((entry: ModeCatalog): boolean => entry.left === left);
    if (next) onSelect(next.key);
  };

  const chooseRight: (right: MatchSide) => void = (right: MatchSide): void => {
    const next: ModeCatalog | undefined = modes.find(
      (entry: ModeCatalog): boolean => entry.left === selectedLeft && entry.right === right,
    );
    if (next) onSelect(next.key);
  };

  return (
    <section className="library-section library-mode-section">
      <div className="section-heading simplified-heading">
        <h2>{t("mode.title")}</h2>
      </div>

      <fieldset className="mode-select-row mode-toggle-block">
        <legend className="sr-only">{t("mode.title")}</legend>
        <label className="sr-only" htmlFor="landing-mode-left">
          {t("mode.left")}
        </label>
        <select
          id="landing-mode-left"
          className="mode-select"
          value={selectedLeft}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>): void =>
            chooseLeft(event.target.value as MatchSide)
          }
        >
          {leftOptions.map(
            (side: MatchSide): React.JSX.Element => (
              <option key={side} value={side}>
                {t(sideLabelKey(side))}
              </option>
            ),
          )}
        </select>

        <span className="mode-vs" aria-hidden="true">
          {t("mode.vs")}
        </span>

        <label className="sr-only" htmlFor="landing-mode-right">
          {t("mode.right")}
        </label>
        <select
          id="landing-mode-right"
          className="mode-select"
          value={selectedRight}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>): void =>
            chooseRight(event.target.value as MatchSide)
          }
        >
          {rightOptions.map((side: MatchSide): React.JSX.Element => {
            const entry: ModeCatalog | undefined = rightModes.find(
              (mode: ModeCatalog): boolean => mode.right === side,
            );
            return (
              <option key={side} value={side} disabled={!entry || entry.playableGames === 0}>
                {t(sideLabelKey(side))}
              </option>
            );
          })}
        </select>
      </fieldset>
    </section>
  );
}
