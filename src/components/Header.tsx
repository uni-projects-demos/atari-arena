import { type JSX, type RefObject, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { GitHubMarkIcon, GlobeIcon, HeaderIcon, MoonIcon, SunIcon } from "./icons";
import LangDialog from "./LangDialog";
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
}: HeaderProps): JSX.Element {
  const { t, locale } = useI18n();
  const langDialogRef: RefObject<HTMLDialogElement | null> = useRef<HTMLDialogElement>(null);
  const langButtonRef: RefObject<HTMLButtonElement | null> = useRef<HTMLButtonElement>(null);
  const [isLangOpen, setIsLangOpen] = useState(false);
  const langLabel: string = t("i18n.language");
  const themeLabel: string = t(theme === "dark" ? "theme.switchToLight" : "theme.switchToDark");
  const openLangDialog: () => void = (): void => {
    setIsLangOpen(true);
    langDialogRef.current?.showModal();
  };

  return (
    <>
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
          ref={langButtonRef}
          type="button"
          variant="outline"
          className="header-action locale-toggle"
          onClick={openLangDialog}
          aria-label={langLabel}
          title={langLabel}
          aria-expanded={isLangOpen}
          aria-controls="language-dialog"
          aria-haspopup="dialog"
        >
          <HeaderIcon>
            <GlobeIcon />
          </HeaderIcon>
          <span className="locale-code" translate="no">
            {locale.toUpperCase()}
          </span>
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

      <LangDialog
        dialogRef={langDialogRef}
        isOpen={isLangOpen}
        onClose={(): void => {
          setIsLangOpen(false);
          langButtonRef.current?.focus();
        }}
      />
    </>
  );
}
