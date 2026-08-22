import { useI18n } from "@/i18n";
import { GitHubMarkIcon, GlobeIcon, HeaderIcon, MoonIcon, SunIcon } from "./icons";
import { Button } from "./ui/button";

export type ThemeMode = "dark" | "light";

interface HeaderProps {
  theme: ThemeMode;
  activeGame: boolean;
  arenaRunning: boolean;
  onBack: () => void;
  onToggleTheme: () => void;
}

const REPO_URL: string = "https://github.com/uni-projects-demos/atari-model-arena-ui/";

export default function Header({
  theme,
  activeGame,
  arenaRunning,
  onBack,
  onToggleTheme,
}: HeaderProps) {
  const { t, locale, locales, setLocale } = useI18n();

  const canSwitchLocale: boolean = locales.length > 1;

  const languageLabel: string = t(
    canSwitchLocale ? "i18n.switchLanguage" : "i18n.currentLanguage",
    {
      locale: locale.toUpperCase(),
    },
  );

  const themeLabel: string = t(theme === "dark" ? "theme.switchToLight" : "theme.switchToDark");

  const cycleLocale = (): void => {
    if (!canSwitchLocale) return;

    const index: number = locales.indexOf(locale);

    setLocale(locales[(index + 1) % locales.length]);
  };

  return (
    <div className="header-actions" role="toolbar" aria-label={t("header.actions")}>
      {activeGame && (
        <Button
          type="button"
          variant="outline"
          className="arena-back-header"
          onClick={onBack}
          disabled={arenaRunning}
        >
          {t("arena.back")}
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        className="header-action theme-toggle"
        onClick={onToggleTheme}
        aria-label={themeLabel}
        title={themeLabel}
      >
        <HeaderIcon>{theme === "dark" ? <SunIcon /> : <MoonIcon />}</HeaderIcon>
      </Button>

      <Button
        type="button"
        variant="outline"
        className="header-action locale-toggle"
        disabled={!canSwitchLocale}
        onClick={cycleLocale}
        aria-label={languageLabel}
        title={languageLabel}
      >
        <HeaderIcon>
          <GlobeIcon />
        </HeaderIcon>
      </Button>

      <a
        className="ui-button ui-button--outline header-action repository-link"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={t("repository.open")}
        title={t("repository.open")}
      >
        <HeaderIcon>
          <GitHubMarkIcon />
        </HeaderIcon>
      </a>
    </div>
  );
}
