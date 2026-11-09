import { type JSX, type RefObject, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { ArrowIcon, GitHubMarkIcon, GlobeIcon, HeaderIcon } from "./icons";
import LangDialog from "./LangDialog";
import { Button } from "./ui/button";

interface HeaderProps {
  activeGame: boolean;
  arenaRunning: boolean;
  onBack: () => void;
}

const REPO_URL: string = "https://github.com/uni-projects-demos/atari-model-arena-ui/";

export default function Header({ activeGame, arenaRunning, onBack }: HeaderProps): JSX.Element {
  const { t, locale } = useI18n();
  const langDialogRef: RefObject<HTMLDialogElement | null> = useRef<HTMLDialogElement>(null);
  const langButtonRef: RefObject<HTMLButtonElement | null> = useRef<HTMLButtonElement>(null);
  const [isLangOpen, setIsLangOpen] = useState(false);
  const langLabel: string = t("i18n.language");
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
            <ArrowIcon direction="left" />
            <span>{t("arena.back")}</span>
          </Button>
        )}

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
