import { type ChangeEvent, type RefObject, useEffect, useRef, useState } from "react";
import { urlWebSocket } from "@/backend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Game, type GameHandle } from "@/game";
import { type Translate, useI18n } from "@/i18n";
import { loadModelRequest, uploadModelRequest } from "@/lib/api";
import { buildURL, DEFAULT_MODE } from "@/lib/routing";
import type {
  GameInfo,
  MatchMode,
  MatchModeKey,
  ModelInfo,
  MsgClient,
  MsgServer,
  ResCatalog,
  UserControlDir,
} from "@/types";
import Stat from "../components/Stat";

type ArenaStatus = "noModel" | "loading" | "idle" | "playing" | "resetting" | "stopped" | "error";

type UploadNotice =
  | { kind: "uploading" }
  | { kind: "using"; name: string }
  | { kind: "error"; message: string }
  | null;

interface Telemetry {
  leftScore: number;
  rightScore: number;
  leftLabel: string;
  rightLabel: string;
  steps: number;
  action: string;
}

interface ArenaPageProps {
  game: GameInfo;
  requestedMode: MatchModeKey | null;
  onBack: () => void;
  onCatalogRefresh: () => Promise<ResCatalog>;
  isBackEndAvailable: boolean;
  onRunningChange: (isRunning: boolean) => void;
}

const KEY_DIRECTIONS: Partial<Record<string, UserControlDir>> = {
  arrowup: "up",
  arrowdown: "down",
  w: "up",
  s: "down",
  " ": "fire",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function preferredModel(models: ModelInfo[]): ModelInfo | null {
  return (
    models.find(({ default: isDefault }: ModelInfo): boolean => isDefault) ?? models[0] ?? null
  );
}

function initialMode(game: GameInfo, requestedMode: MatchModeKey | null): MatchMode | null {
  return (
    (requestedMode
      ? game.modes.find(({ key }: MatchMode): boolean => key === requestedMode)
      : null) ??
    game.modes.find(
      ({ key, available }: MatchMode): boolean => key === DEFAULT_MODE && available,
    ) ??
    game.modes.find(({ available }: MatchMode): boolean => available) ??
    game.modes.find(({ key }: MatchMode): boolean => key === DEFAULT_MODE) ??
    game.modes[0] ??
    null
  );
}

function initialTelemetry(mode: MatchMode | null): Telemetry {
  return {
    leftScore: 0,
    rightScore: 0,
    leftLabel: mode?.left_label ?? "LEFT",
    rightLabel: mode?.right_label ?? "RIGHT",
    steps: 0,
    action: "—",
  };
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function localizedScoreLabel(label: string, t: Translate): string {
  return t(`score.${label.toLowerCase()}`, undefined, label);
}

function uploadNoticeTxt(notice: UploadNotice, t: Translate): string {
  if (!notice) return "";

  switch (notice.kind) {
    case "uploading":
      return t("arena.uploading");
    case "using":
      return t("arena.usingModel", {
        name: notice.name,
      });
    case "error":
      return notice.message;
  }
}

function sendJSON(socket: WebSocket | null | undefined, payload: MsgClient): boolean {
  if (socket?.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function closeSocket(ref: RefObject<WebSocket | null>, notify = true): void {
  if (notify) {
    sendJSON(ref.current, { type: "stop" });
  }
  ref.current?.close();
  ref.current = null;
}

export default function ArenaPage({
  game,
  requestedMode,
  onBack,
  onCatalogRefresh,
  isBackEndAvailable,
  onRunningChange,
}: ArenaPageProps) {
  const { t } = useI18n();
  const firstMode: MatchMode | null = initialMode(game, requestedMode);

  const [modeKey, setModeKey] = useState<MatchModeKey | null>(firstMode?.key ?? null);
  const [activeModelId, setActiveModelId] = useState<string | null>(
    preferredModel(game.models)?.id ?? null,
  );
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<ArenaStatus>("noModel");
  const [errorMessage, setErrorMessage] = useState("");
  const [fps, setFps] = useState(20);
  const [uploadNotice, setUploadNotice] = useState<UploadNotice>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [telemetry, setTelemetry] = useState((): Telemetry => initialTelemetry(firstMode));

  const wsRef = useRef<WebSocket | null>(null);
  const pixiRef = useRef<GameHandle | null>(null);
  const viewportDetachRef = useRef<(() => void) | null>(null);

  const mode: MatchMode | null =
    game.modes.find(({ key }: MatchMode): boolean => key === modeKey) ?? null;
  const activeModel: ModelInfo | null =
    game.models.find(({ id }: ModelInfo): boolean => id === activeModelId) ??
    preferredModel(game.models);

  const isRunning: boolean = status === "playing" || status === "resetting";
  const isSessionActive: boolean = isRunning || starting;
  const isBusy: boolean = isSessionActive || status === "loading";
  const isModelLoaded: boolean = Boolean(activeModel && loadedModelId === activeModel.id);
  const isPlayable: boolean = Boolean(mode?.available && activeModel);
  const canStart: boolean = isBackEndAvailable && isPlayable && isModelLoaded && !isBusy;

  const detachViewport: () => void = (): void => {
    viewportDetachRef.current?.();
    viewportDetachRef.current = null;
  };
  const stop: () => void = (): void => {
    detachViewport();
    closeSocket(wsRef);
    setStarting(false);
    setStatus("stopped");
    setErrorMessage("");
  };

  useEffect((): void => {
    onRunningChange(isSessionActive);
  }, [isSessionActive, onRunningChange]);

  useEffect(
    (): (() => void) => (): void => {
      viewportDetachRef.current?.();
      viewportDetachRef.current = null;
      closeSocket(wsRef);
      onRunningChange(false);
    },
    [onRunningChange],
  );

  useEffect((): (() => void) | undefined => {
    if (!mode?.is_user || !isRunning) {
      return;
    }

    const handleKey = (event: KeyboardEvent, isPressed: boolean): void => {
      const direction: UserControlDir | undefined = KEY_DIRECTIONS[event.key.toLowerCase()];
      if (!direction) return;

      const isSent: boolean = sendJSON(wsRef.current, {
        type: "input",
        direction: isPressed ? direction : "none",
      });
      if (isSent) {
        event.preventDefault();
      }
    };

    const keyDown = (event: KeyboardEvent): void => handleKey(event, true);
    const keyUp = (event: KeyboardEvent): void => handleKey(event, false);

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    return (): void => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [mode?.is_user, isRunning]);

  const handleSocketMsg = (message: MsgServer): void => {
    if (message.type === "started") {
      setStarting(false);
      setStatus("playing");
      return;
    }
    if (message.type === "error") {
      setErrorMessage(message.message || t("error.backendStart"));
      setStarting(false);
      setStatus("error");
      return;
    }

    setStatus(
      (
        current: ArenaStatus,
      ): "noModel" | "loading" | "idle" | "playing" | "resetting" | "stopped" | "error" =>
        current === "resetting" ? "playing" : current,
    );

    setTelemetry({
      leftScore: message.left_score,
      rightScore: message.right_score,
      leftLabel: message.left_label,
      rightLabel: message.right_label,
      steps: message.steps,
      action: `${message.model_action_name} (${message.model_action})`,
    });
  };

  const loadModel: () => Promise<void> = async (): Promise<void> => {
    if (!activeModel || isBusy || isModelLoaded) {
      return;
    }
    setErrorMessage("");
    setLoadedModelId(null);
    setStatus("loading");

    try {
      const data = await loadModelRequest(game.key, activeModel.id, t("error.modelLoad"));
      setLoadedModelId(data.id);
      setStatus("idle");
    } catch (error) {
      setErrorMessage(errorText(error));
      setStatus("error");
    }
  };

  const start: () => void = (): void => {
    if (!mode || !activeModel || !isModelLoaded || isBusy) {
      return;
    }
    const socket = new WebSocket(urlWebSocket("/ws/play"));

    wsRef.current = socket;
    detachViewport();
    viewportDetachRef.current = pixiRef.current?.attachSocket(socket, handleSocketMsg) ?? null;

    setErrorMessage("");
    setStarting(true);

    socket.onopen = (): void => {
      sendJSON(socket, {
        type: "start",
        game: game.key,
        mode: mode.key,
        profile: "auto",
        model: activeModel.id,
        fps,
      });
    };

    socket.onclose = (): void => {
      if (wsRef.current !== socket) {
        return;
      }
      detachViewport();
      wsRef.current = null;
      setStarting(false);
      setStatus((current: ArenaStatus): "stopped" | "error" =>
        current === "error" ? current : "stopped",
      );
    };
  };

  const reset: () => void = (): void => {
    if (sendJSON(wsRef.current, { type: "reset" })) {
      setStatus("resetting");
    }
  };

  const chooseMode = (nextMode: MatchMode): void => {
    if (isSessionActive || !nextMode.available) {
      return;
    }

    pixiRef.current?.clear();
    setModeKey(nextMode.key);

    if (status === "stopped" && isModelLoaded) {
      setStatus("idle");
    }

    history.replaceState(
      {
        gameKey: game.key,
        modeKey: nextMode.key,
      },
      "",
      buildURL(game.key, nextMode.key),
    );

    setTelemetry(initialTelemetry(nextMode));
  };

  const upload: () => Promise<void> = async (): Promise<void> => {
    if (!uploadFile || isBusy) {
      return;
    }
    setUploadNotice({ kind: "uploading" });

    try {
      const data = await uploadModelRequest(uploadFile, game.key, t("error.upload"));
      const catalog: ResCatalog = await onCatalogRefresh();
      const uploadedId: string =
        catalog.games
          .find(({ key }: GameInfo): boolean => key === game.key)
          ?.models.find(({ id }: ModelInfo): boolean => id === data.id)?.id ?? data.id;

      setActiveModelId(uploadedId);
      setLoadedModelId(uploadedId);
      setStatus("idle");

      setUploadNotice({
        kind: "using",
        name: data.name,
      });
    } catch (error) {
      setUploadNotice({
        kind: "error",
        message: errorText(error),
      });
    }
  };

  const overlay: string | null = status === "error" ? errorMessage || t("error.game") : null;

  return (
    <div className="arena-page">
      <div className="arena-nav arena-nav-desktop">
        <Button variant="outline" onClick={onBack} disabled={isSessionActive}>
          {t("arena.back")}
        </Button>
      </div>

      {!isPlayable && <div className="alert">{mode?.error || t("error.noTrainedModel")}</div>}
      {errorMessage && <div className="alert">{errorMessage}</div>}

      <div className="arena-layout">
        <Card className="controls-card">
          <CardContent className="controls-stack controls-stack-clean">
            <fieldset className="mode-toggle-block">
              <legend className="field-label mode-toggle-label">{t("mode.modelVs")}</legend>

              <div className="arena-mode-buttons">
                {game.modes.map((entry: MatchMode) => (
                  <Button
                    key={entry.key}
                    variant={entry.key === modeKey ? "default" : "outline"}
                    disabled={isSessionActive || !entry.available}
                    onClick={(): void => chooseMode(entry)}
                    aria-pressed={entry.key === modeKey}
                  >
                    {t(entry.is_user ? "mode.user" : "mode.game")}
                  </Button>
                ))}
              </div>
            </fieldset>

            <div className="model-block">
              <span className="field-label mode-toggle-label">{t("arena.trainedModel")}</span>

              <div className="model-value-row">
                <div className="model-value">
                  <b>{activeModel?.name ?? t("arena.noTrainedModel")}</b>
                </div>

                <Button
                  variant="outline"
                  disabled={!isBackEndAvailable || !activeModel || isBusy || isModelLoaded}
                  onClick={loadModel}
                >
                  {t("arena.load")}
                </Button>
              </div>
            </div>

            <div className="upload-block">
              <Input
                type="file"
                accept=".pt,.pth,.zip"
                disabled={!isBackEndAvailable || isBusy}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setUploadFile(event.target.files?.[0] ?? null)
                }
              />

              <Button
                variant="outline"
                disabled={!isBackEndAvailable || isBusy || !uploadFile}
                onClick={upload}
              >
                {t("arena.uploadAndUseModel")}
              </Button>

              {uploadNotice && <p className="muted compact">{uploadNoticeTxt(uploadNotice, t)}</p>}
            </div>

            <label className="range-field">
              <span className="field-label">
                {t("arena.gameSpeed", {
                  fps,
                })}
              </span>

              <input
                type="range"
                min={5}
                max={60}
                value={fps}
                disabled={isRunning}
                onChange={(event: ChangeEvent<HTMLInputElement, HTMLInputElement>): void =>
                  setFps(Number(event.target.value))
                }
              />
            </label>

            <div className="action-row">
              <Button disabled={isRunning ? false : !canStart} onClick={isRunning ? stop : start}>
                {t(isRunning ? "arena.stop" : "arena.start")}
              </Button>
              <Button variant="outline" disabled={!isRunning} onClick={reset}>
                {t("arena.reset")}
              </Button>
            </div>

            {(mode?.user_controls?.move || mode?.user_controls?.fire) && (
              <div className="controls-block">
                <span className="field-label mode-toggle-label">{t("arena.controls")}</span>

                <div className="control-instructions">
                  {mode.user_controls?.move && (
                    <div className="control-instruction">
                      <span className="field-label">{t("arena.move")}</span>
                      <kbd>{mode.user_controls.move}</kbd>
                    </div>
                  )}

                  {mode.user_controls?.fire && (
                    <div className="control-instruction">
                      <span className="field-label">{t("arena.fireServe")}</span>
                      <kbd>{mode.user_controls.fire}</kbd>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="game-card-panel">
          <CardContent className="game-stage-content">
            <div className="score-bar">
              <div>
                <span>{localizedScoreLabel(telemetry.leftLabel, t)}</span>
                <strong>{formatScore(telemetry.leftScore)}</strong>
              </div>

              <Badge variant={isRunning ? "success" : "secondary"}>
                {isBackEndAvailable ? t(`status.${status}`) : t("status.serverUnavailable")}
              </Badge>

              <div className="score-right">
                <span>{localizedScoreLabel(telemetry.rightLabel, t)}</span>
                <strong>{formatScore(telemetry.rightScore)}</strong>
              </div>
            </div>

            <Game ref={pixiRef} overlay={overlay} />

            <div className="telemetry-grid telemetry-grid-compact">
              <Stat label={t("arena.steps")} value={String(telemetry.steps)} />
              <Stat label={t("arena.modelAction")} value={telemetry.action} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
