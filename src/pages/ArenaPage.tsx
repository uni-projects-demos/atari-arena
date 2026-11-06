import { type ChangeEvent, type JSX, type RefObject, useEffect, useRef, useState } from "react";
import { type GameSocket, modelFileAccept, openGameSocket } from "@/backend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Game, type GameHandle } from "@/game/game";
import { type Translate, useI18n } from "@/i18n";
import { loadModelRequest, uploadModelRequest } from "@/lib/api";
import { controlDirection, isControlKey } from "@/lib/controls";
import { modeSides, sideLabelKey, sortSides } from "@/lib/modes";
import { buildURL, DEFAULT_MODE } from "@/lib/routing";
import type {
  GameInfo,
  MatchMode,
  MatchModeKey,
  MatchSide,
  ModelInfo,
  MsgClient,
  MsgServer,
  NamedEntity,
  PlayerSlot,
  ResCatalog,
} from "@/types";
import Stat from "../components/Stat";

type ArenaStatus = "noModel" | "loading" | "idle" | "playing" | "resetting" | "stopped" | "error";

type UploadNotice =
  | { kind: "uploading" }
  | { kind: "using"; name: string }
  | { kind: "error"; message: string }
  | null;

type ModelSlotKey = "I" | "II";
type PlayerTone = "green" | "blue";

interface Telemetry {
  leftScore: number;
  rightScore: number;
  leftLabel: string;
  rightLabel: string;
  steps: number;
  action: string;
  leftAction: string;
  rightAction: string;
}

interface ArenaPageProps {
  game: GameInfo;
  requestedMode: MatchModeKey | null;
  onBack: () => void;
  onCatalogRefresh: () => Promise<ResCatalog>;
  isBackEndAvailable: boolean;
  onRunningChange: (isRunning: boolean) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function preferredModel(models: ModelInfo[], slot: ModelSlotKey = "I"): ModelInfo | null {
  return (
    (slot === "II"
      ? models.find(({ default_model_ii: isDefault }: ModelInfo): boolean => isDefault === true)
      : null) ??
    models.find(({ default: isDefault }: ModelInfo): boolean => isDefault) ??
    models[0] ??
    null
  );
}

function modelDisplayName(model: ModelInfo): string {
  return model.name.replace(/\s*[·•]\s*default\s*$/i, "").trim();
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
    leftAction: "—",
    rightAction: "—",
  };
}

function modelPlayerCount(mode: MatchMode | null): number {
  if (!mode) return 0;
  if (mode.players) {
    return mode.players.filter(({ player_type }: PlayerSlot): boolean => player_type === "model")
      .length;
  }
  const sides: { left: MatchSide; right: MatchSide } = modeSides(mode);
  return Number(sides.left === "model") + Number(sides.right === "model");
}

function modelReadyStatus(
  mode: MatchMode | null,
  modelIds: Record<ModelSlotKey, string | null>,
  loadedModelIds: Set<string>,
): "idle" | "noModel" {
  const modelCount: number = modelPlayerCount(mode);
  if (modelCount === 0) return "idle";

  const isReadyModelI: boolean = Boolean(modelIds.I && loadedModelIds.has(modelIds.I));
  const isReadyModelII: boolean =
    modelCount < 2 || Boolean(modelIds.II && loadedModelIds.has(modelIds.II));
  return isReadyModelI && isReadyModelII ? "idle" : "noModel";
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function localizedScoreLabel(label: string, t: Translate): string {
  return t(`score.${label.toLowerCase()}`, undefined, label);
}

function modelSlotForSide(mode: MatchMode | null, side: "left" | "right"): string | null {
  return (
    mode?.players?.find(
      ({ player_type, side: slotSide }: PlayerSlot): boolean =>
        player_type === "model" && slotSide === side,
    )?.key ?? null
  );
}

function playerActionText(message: Extract<MsgServer, { type: "frame" }>, slot: string): string {
  const action: number | undefined = message.player_actions?.[slot];
  const actionName: string | undefined = message.player_action_names?.[slot];
  if (actionName === undefined && action === undefined) return "—";
  return `${actionName ?? String(action)}${action === undefined ? "" : ` (${action})`}`;
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

function sendJSON(socket: GameSocket | null | undefined, payload: MsgClient): boolean {
  if (socket?.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function closeSocket(ref: RefObject<GameSocket | null>, notify = true): void {
  if (notify) {
    sendJSON(ref.current, { type: "stop" });
  }
  ref.current?.close();
  ref.current = null;
}

interface ModelSectionProps {
  label: string;
  tone?: PlayerTone;
  activeModel: ModelInfo | null;
  isLoaded: boolean;
  isLoading: boolean;
  isDisabled: boolean;
  uploadFile: File | null;
  uploadNotice: UploadNotice;
  onLoad: () => void;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
  t: Translate;
  isBackEndAvailable: boolean;
}

function ModelSection({
  label,
  tone,
  activeModel,
  isLoaded,
  isLoading,
  isDisabled,
  uploadFile,
  uploadNotice,
  onLoad,
  onFileChange,
  onUpload,
  t,
  isBackEndAvailable,
}: ModelSectionProps): JSX.Element {
  const toneClass: string = tone ? ` model-section--${tone}` : "";

  return (
    <div className={`model-section${toneClass}`}>
      <div className="model-block">
        <span className="field-label mode-toggle-label model-section-label">{label}</span>

        <div className="model-value-row">
          <div className="model-name">
            {activeModel ? modelDisplayName(activeModel) : t("arena.noTrainedModel")}
          </div>

          <Button
            variant="outline"
            disabled={!isBackEndAvailable || !activeModel || isDisabled || isLoaded}
            onClick={onLoad}
          >
            {isLoading ? t("status.loading") : isLoaded ? t("arena.loaded") : t("arena.load")}
          </Button>
        </div>
      </div>

      <div className="upload-block">
        <Input
          type="file"
          accept={modelFileAccept}
          disabled={!isBackEndAvailable || isDisabled}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onFileChange(event.target.files?.[0] ?? null)
          }
        />

        <Button
          variant="outline"
          disabled={!isBackEndAvailable || isDisabled || !uploadFile}
          onClick={onUpload}
        >
          {t("arena.uploadAndUseModel")}
        </Button>

        {uploadNotice && <p className="muted compact">{uploadNoticeTxt(uploadNotice, t)}</p>}
      </div>
    </div>
  );
}

export default function ArenaPage({
  game,
  requestedMode,
  onBack,
  onCatalogRefresh,
  isBackEndAvailable,
  onRunningChange,
}: ArenaPageProps): JSX.Element {
  const { t } = useI18n();
  const firstMode: MatchMode | null = initialMode(game, requestedMode);
  const firstIdModelI: string | null = preferredModel(game.models, "I")?.id ?? null;
  const firstIdModelII: string | null = preferredModel(game.models, "II")?.id ?? null;

  const [modeKey, setModeKey] = useState<MatchModeKey | null>(firstMode?.key ?? null);
  const [activeModelIds, setActiveModelIds] = useState<Record<ModelSlotKey, string | null>>({
    I: firstIdModelI,
    II: firstIdModelII,
  });
  const [loadedModelIds, setLoadedModelIds] = useState<Set<string>>(
    (): Set<string> => new Set<string>(),
  );
  const [loadingSlot, setLoadingSlot] = useState<ModelSlotKey | null>(null);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<ArenaStatus>((): "idle" | "noModel" =>
    modelPlayerCount(firstMode) === 0 ? "idle" : "noModel",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [fps, setFps] = useState(20);
  const [uploadNotices, setUploadNotices] = useState<Record<ModelSlotKey, UploadNotice>>({
    I: null,
    II: null,
  });
  const [uploadFiles, setUploadFiles] = useState<Record<ModelSlotKey, File | null>>({
    I: null,
    II: null,
  });
  const [telemetry, setTelemetry] = useState((): Telemetry => initialTelemetry(firstMode));

  const wsRef: RefObject<GameSocket | null> = useRef<GameSocket | null>(null);
  const pixiRef: RefObject<GameHandle | null> = useRef<GameHandle | null>(null);
  const viewportDetachRef: RefObject<(() => void) | null> = useRef<(() => void) | null>(null);
  const pressedControlKeysRef: RefObject<Set<string>> = useRef<Set<string>>(new Set<string>());

  const mode: MatchMode | null =
    game.modes.find(({ key }: MatchMode): boolean => key === modeKey) ?? null;
  const modeEntries: { mode: MatchMode; left: MatchSide; right: MatchSide }[] = game.modes.map(
    (entry: MatchMode): { mode: MatchMode; left: MatchSide; right: MatchSide } => ({
      mode: entry,
      ...modeSides(entry),
    }),
  );
  const currentSides: { left: MatchSide; right: MatchSide } = mode
    ? modeSides(mode)
    : { left: "model", right: "model" };
  const leftModeOptions: MatchSide[] = sortSides(
    modeEntries.map(({ left }: { left: MatchSide }): MatchSide => left),
  );
  const rightModeEntries: { mode: MatchMode; left: MatchSide; right: MatchSide }[] =
    modeEntries.filter(({ left }: { left: MatchSide }): boolean => left === currentSides.left);
  const rightModeOptions: MatchSide[] = sortSides(
    rightModeEntries.map(({ right }: { right: MatchSide }): MatchSide => right),
    "right",
  );
  const activeModelI: ModelInfo | null =
    game.models.find(({ id }: ModelInfo): boolean => id === activeModelIds.I) ??
    preferredModel(game.models, "I");
  const activeModelII: ModelInfo | null =
    game.models.find(({ id }: ModelInfo): boolean => id === activeModelIds.II) ??
    preferredModel(game.models, "II");
  const modelCount: number = modelPlayerCount(mode);
  const isRequireModel: boolean = modelCount > 0;
  const isModelVsModel: boolean = modelCount > 1;
  const isSameModelMatch: boolean = Boolean(
    isModelVsModel && activeModelI && activeModelII && activeModelI.id === activeModelII.id,
  );
  const selectedModelIds: Record<ModelSlotKey, string | null> = {
    I: activeModelI?.id ?? null,
    II: activeModelII?.id ?? null,
  };
  const leftTone: PlayerTone = "green";
  const rightTone: PlayerTone = isSameModelMatch ? "green" : "blue";

  const isRunning: boolean = status === "playing" || status === "resetting";
  const isSessionActive: boolean = isRunning || starting;
  const isUploading: boolean = Object.values(uploadNotices).some(
    (notice: UploadNotice): boolean => notice?.kind === "uploading",
  );
  const isBusy: boolean =
    isSessionActive || loadingSlot !== null || status === "loading" || isUploading;
  const isLoadedModelI: boolean = Boolean(activeModelI && loadedModelIds.has(activeModelI.id));
  const isLoadedModelII: boolean = Boolean(activeModelII && loadedModelIds.has(activeModelII.id));
  const isPlayable: boolean = Boolean(
    mode?.available && (!isRequireModel || (activeModelI && (!isModelVsModel || activeModelII))),
  );
  const areRequiredModelsLoaded: boolean =
    !isRequireModel || (isLoadedModelI && (!isModelVsModel || isLoadedModelII));
  const canStart: boolean = isBackEndAvailable && isPlayable && areRequiredModelsLoaded && !isBusy;

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
    pressedControlKeysRef.current.clear();
    if (!mode?.is_user || !isRunning) {
      return;
    }

    const handleKey: (event: KeyboardEvent, isPressed: boolean) => void = (
      event: KeyboardEvent,
      isPressed: boolean,
    ): void => {
      const key: string = event.key.toLowerCase();
      if (!isControlKey(key)) return;

      const pressed: Set<string> = pressedControlKeysRef.current;
      if (isPressed) {
        pressed.add(key);
      } else {
        pressed.delete(key);
      }

      const direction = controlDirection(pressed, mode.user_controls?.layout);

      const isSent: boolean = sendJSON(wsRef.current, {
        type: "input",
        direction,
      });
      if (isSent) {
        event.preventDefault();
      }
    };

    const keyDown: (event: KeyboardEvent) => void = (event: KeyboardEvent): void =>
      handleKey(event, true);
    const keyUp: (event: KeyboardEvent) => void = (event: KeyboardEvent): void =>
      handleKey(event, false);

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    return (): void => {
      pressedControlKeysRef.current.clear();
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [mode?.is_user, mode?.user_controls?.layout, isRunning]);

  const handleSocketMsg: (message: MsgServer) => void = (message: MsgServer): void => {
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

    const fallbackAction: string = `${message.model_action_name} (${message.model_action})`;
    const leftModelSlot: string | null = modelSlotForSide(mode, "left");
    const rightModelSlot: string | null = modelSlotForSide(mode, "right");
    setTelemetry({
      leftScore: message.left_score,
      rightScore: message.right_score,
      leftLabel: message.left_label,
      rightLabel: message.right_label,
      steps: message.steps,
      action: fallbackAction,
      leftAction: leftModelSlot ? playerActionText(message, leftModelSlot) : fallbackAction,
      rightAction: rightModelSlot ? playerActionText(message, rightModelSlot) : fallbackAction,
    });
  };

  const loadModel: (slot: ModelSlotKey) => Promise<void> = async (
    slot: ModelSlotKey,
  ): Promise<void> => {
    const activeModel: ModelInfo | null = slot === "I" ? activeModelI : activeModelII;
    if (!activeModel || isBusy || loadedModelIds.has(activeModel.id)) {
      return;
    }
    setErrorMessage("");
    setLoadingSlot(slot);
    setStatus("loading");

    try {
      const data: NamedEntity = await loadModelRequest(
        game.key,
        activeModel.id,
        t("error.modelLoad"),
      );
      const nextLoadedModelIds: Set<string> = new Set(loadedModelIds);
      nextLoadedModelIds.add(data.id);
      setLoadedModelIds(nextLoadedModelIds);
      setLoadingSlot(null);
      setStatus(modelReadyStatus(mode, selectedModelIds, nextLoadedModelIds));
    } catch (error) {
      setLoadingSlot(null);
      setErrorMessage(errorText(error));
      setStatus("error");
    }
  };

  const start: () => void = (): void => {
    if (!mode || !areRequiredModelsLoaded || isBusy) {
      return;
    }
    if (isRequireModel && !activeModelI) return;
    if (isModelVsModel && !activeModelII) return;

    let fallbackModelIdx: number = 0;
    const modelBySlot: (slot: {
      player_type: "human" | "model";
      side?: "left" | "right" | null;
    }) => ModelInfo | null = (slot: {
      player_type: "human" | "model";
      side?: "left" | "right" | null;
    }): ModelInfo | null => {
      if (slot.player_type !== "model") return null;
      if (!isModelVsModel) return activeModelI;
      if (slot.side === "left") return activeModelI;
      if (slot.side === "right") return activeModelII;
      const selected: ModelInfo | null = fallbackModelIdx === 0 ? activeModelI : activeModelII;
      fallbackModelIdx += 1;
      return selected;
    };

    const socket = openGameSocket();

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
        ...(isRequireModel && activeModelI ? { model: activeModelI.id } : {}),
        players: mode.players?.map(
          (slot: PlayerSlot): { slot: string; type: "human" | "model" } => {
            const selectedModel: ModelInfo | null = modelBySlot(slot);
            return {
              slot: slot.key,
              type: slot.player_type,
              ...(selectedModel ? { model: selectedModel.id } : {}),
            };
          },
        ),
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

  const chooseMode: (nextMode: MatchMode) => void = (nextMode: MatchMode): void => {
    if (isBusy || !nextMode.available) {
      return;
    }

    pixiRef.current?.clear();
    setModeKey(nextMode.key);

    setStatus(modelReadyStatus(nextMode, selectedModelIds, loadedModelIds));

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

  const chooseLeftMode: (left: MatchSide) => void = (left: MatchSide): void => {
    const candidates: { mode: MatchMode; left: MatchSide; right: MatchSide }[] = modeEntries.filter(
      (entry: { mode: MatchMode; left: MatchSide; right: MatchSide }): boolean =>
        entry.left === left,
    );
    const next: { mode: MatchMode; left: MatchSide; right: MatchSide } =
      candidates.find(
        (entry: { mode: MatchMode; left: MatchSide; right: MatchSide }): boolean =>
          entry.right === currentSides.right && entry.mode.available,
      ) ??
      candidates.find(
        (entry: { mode: MatchMode; left: MatchSide; right: MatchSide }): boolean =>
          entry.mode.available,
      ) ??
      candidates.find(
        (entry: { mode: MatchMode; left: MatchSide; right: MatchSide }): boolean =>
          entry.right === currentSides.right,
      ) ??
      candidates[0];
    if (next) chooseMode(next.mode);
  };

  const chooseRightMode: (right: MatchSide) => void = (right: MatchSide): void => {
    const next: { mode: MatchMode; left: MatchSide; right: MatchSide } | undefined =
      rightModeEntries.find(
        (entry: { mode: MatchMode; left: MatchSide; right: MatchSide }): boolean =>
          entry.right === right,
      );
    if (next) chooseMode(next.mode);
  };

  const upload: (slot: ModelSlotKey) => Promise<void> = async (
    slot: ModelSlotKey,
  ): Promise<void> => {
    const uploadFile: File | null = uploadFiles[slot];
    if (!uploadFile || isBusy) {
      return;
    }
    setErrorMessage("");
    setLoadingSlot(slot);
    setStatus("loading");
    setUploadNotices(
      (
        current: Record<ModelSlotKey, UploadNotice>,
      ): {
        I:
          | { kind: "uploading" }
          | { kind: "using"; name: string }
          | { kind: "error"; message: string }
          | null;
        II:
          | { kind: "uploading" }
          | { kind: "using"; name: string }
          | { kind: "error"; message: string }
          | null;
      } => ({ ...current, [slot]: { kind: "uploading" } }),
    );

    try {
      const data: NamedEntity = await uploadModelRequest(uploadFile, game.key, t("error.upload"));
      const catalog: ResCatalog = await onCatalogRefresh();
      const uploadedId: string =
        catalog.games
          .find(({ key }: GameInfo): boolean => key === game.key)
          ?.models.find(({ id }: ModelInfo): boolean => id === data.id)?.id ?? data.id;

      const nextModelIds: Record<ModelSlotKey, string | null> = {
        ...selectedModelIds,
        [slot]: uploadedId,
      };
      const nextLoadedModelIds: Set<string> = new Set(loadedModelIds);
      nextLoadedModelIds.add(uploadedId);
      setActiveModelIds(nextModelIds);
      setLoadedModelIds(nextLoadedModelIds);
      setLoadingSlot(null);
      setStatus(modelReadyStatus(mode, nextModelIds, nextLoadedModelIds));

      setUploadNotices(
        (
          current: Record<ModelSlotKey, UploadNotice>,
        ): {
          I:
            | { kind: "uploading" }
            | { kind: "using"; name: string }
            | { kind: "error"; message: string }
            | null;
          II:
            | { kind: "uploading" }
            | { kind: "using"; name: string }
            | { kind: "error"; message: string }
            | null;
        } => ({
          ...current,
          [slot]: {
            kind: "using",
            name: data.name,
          },
        }),
      );
    } catch (error) {
      setLoadingSlot(null);
      setStatus("error");
      setUploadNotices(
        (
          current: Record<ModelSlotKey, UploadNotice>,
        ): {
          I:
            | { kind: "uploading" }
            | { kind: "using"; name: string }
            | { kind: "error"; message: string }
            | null;
          II:
            | { kind: "uploading" }
            | { kind: "using"; name: string }
            | { kind: "error"; message: string }
            | null;
        } => ({
          ...current,
          [slot]: {
            kind: "error",
            message: errorText(error),
          },
        }),
      );
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
              <legend className="field-label mode-toggle-label">{t("mode.title")}</legend>

              <div className="mode-select-row arena-mode-select-row">
                <label className="sr-only" htmlFor="arena-mode-left">
                  {t("mode.left")}
                </label>
                <select
                  id="arena-mode-left"
                  className="mode-select"
                  value={currentSides.left}
                  disabled={isSessionActive}
                  onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                    chooseLeftMode(event.target.value as MatchSide)
                  }
                >
                  {leftModeOptions.map((side: MatchSide): JSX.Element => {
                    const canUse: boolean = modeEntries.some(
                      (entry: { mode: MatchMode; left: MatchSide; right: MatchSide }): boolean =>
                        entry.left === side && entry.mode.available,
                    );
                    return (
                      <option key={side} value={side} disabled={!canUse}>
                        {t(sideLabelKey(side))}
                      </option>
                    );
                  })}
                </select>

                <span className="mode-vs" aria-hidden="true">
                  {t("mode.vs")}
                </span>

                <label className="sr-only" htmlFor="arena-mode-right">
                  {t("mode.right")}
                </label>
                <select
                  id="arena-mode-right"
                  className="mode-select"
                  value={currentSides.right}
                  disabled={isSessionActive}
                  onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                    chooseRightMode(event.target.value as MatchSide)
                  }
                >
                  {rightModeOptions.map((side: MatchSide): JSX.Element => {
                    const entry:
                      | { mode: MatchMode; left: MatchSide; right: MatchSide }
                      | undefined = rightModeEntries.find(
                      (candidate: {
                        mode: MatchMode;
                        left: MatchSide;
                        right: MatchSide;
                      }): boolean => candidate.right === side,
                    );
                    return (
                      <option key={side} value={side} disabled={!entry?.mode.available}>
                        {t(sideLabelKey(side))}
                      </option>
                    );
                  })}
                </select>
              </div>
            </fieldset>

            {isModelVsModel ? (
              <div className="model-versus-stack">
                <ModelSection
                  label={t("arena.modelI")}
                  tone={leftTone}
                  activeModel={activeModelI}
                  isLoaded={isLoadedModelI}
                  isLoading={loadingSlot === "I"}
                  isDisabled={isBusy}
                  uploadFile={uploadFiles.I}
                  uploadNotice={uploadNotices.I}
                  onLoad={(): void => void loadModel("I")}
                  onFileChange={(file: File | null): void =>
                    setUploadFiles(
                      (
                        current: Record<ModelSlotKey, File | null>,
                      ): { I: File | null; II: File | null } => ({ ...current, I: file }),
                    )
                  }
                  onUpload={(): void => void upload("I")}
                  t={t}
                  isBackEndAvailable={isBackEndAvailable}
                />

                <div className="model-versus-divider" aria-hidden="true">
                  {t("mode.vs")}
                </div>

                <ModelSection
                  label={t("arena.modelII")}
                  tone={rightTone}
                  activeModel={activeModelII}
                  isLoaded={isLoadedModelII}
                  isLoading={loadingSlot === "II"}
                  isDisabled={isBusy}
                  uploadFile={uploadFiles.II}
                  uploadNotice={uploadNotices.II}
                  onLoad={(): void => void loadModel("II")}
                  onFileChange={(file: File | null): void =>
                    setUploadFiles(
                      (
                        current: Record<ModelSlotKey, File | null>,
                      ): { I: File | null; II: File | null } => ({ ...current, II: file }),
                    )
                  }
                  onUpload={(): void => void upload("II")}
                  t={t}
                  isBackEndAvailable={isBackEndAvailable}
                />
              </div>
            ) : isRequireModel ? (
              <ModelSection
                label={t("arena.trainedModel")}
                activeModel={activeModelI}
                isLoaded={isLoadedModelI}
                isLoading={loadingSlot === "I"}
                isDisabled={isBusy}
                uploadFile={uploadFiles.I}
                uploadNotice={uploadNotices.I}
                onLoad={(): void => void loadModel("I")}
                onFileChange={(file: File | null): void =>
                  setUploadFiles(
                    (
                      current: Record<ModelSlotKey, File | null>,
                    ): { I: File | null; II: File | null } => ({ ...current, I: file }),
                  )
                }
                onUpload={(): void => void upload("I")}
                t={t}
                isBackEndAvailable={isBackEndAvailable}
              />
            ) : null}

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
              <div
                className={isModelVsModel ? `score-player score-player--${leftTone}` : undefined}
              >
                <span>
                  {isModelVsModel ? t("arena.modelI") : localizedScoreLabel(telemetry.leftLabel, t)}
                </span>
                <strong
                  className={isModelVsModel ? `score-value score-value--${leftTone}` : undefined}
                >
                  {formatScore(telemetry.leftScore)}
                </strong>
              </div>

              <Badge variant={isRunning ? "success" : "secondary"}>
                {isBackEndAvailable ? t(`status.${status}`) : t("status.serverUnavailable")}
              </Badge>

              <div
                className={`score-right${
                  isModelVsModel ? ` score-player score-player--${rightTone}` : ""
                }`}
              >
                <span>
                  {isModelVsModel
                    ? t("arena.modelII")
                    : localizedScoreLabel(telemetry.rightLabel, t)}
                </span>
                <strong
                  className={isModelVsModel ? `score-value score-value--${rightTone}` : undefined}
                >
                  {formatScore(telemetry.rightScore)}
                </strong>
              </div>
            </div>

            <Game
              ref={pixiRef}
              overlay={overlay}
              paddleColors={
                isModelVsModel && game.key === "pong" ? { left: leftTone, right: rightTone } : null
              }
            />

            <div
              className={`telemetry-grid ${
                isModelVsModel ? "telemetry-grid--versus" : "telemetry-grid-compact"
              }`}
            >
              {isModelVsModel ? (
                <>
                  <Stat
                    className={`stat--${leftTone}`}
                    label={`${t("arena.modelI")} · ${t("arena.action", undefined, "Action")}`}
                    value={telemetry.leftAction}
                  />
                  <Stat label={t("arena.steps")} value={String(telemetry.steps)} />
                  <Stat
                    className={`stat--${rightTone}`}
                    label={`${t("arena.modelII")} · ${t("arena.action", undefined, "Action")}`}
                    value={telemetry.rightAction}
                  />
                </>
              ) : (
                <>
                  <Stat label={t("arena.steps")} value={String(telemetry.steps)} />
                  {isRequireModel && (
                    <Stat label={t("arena.action", undefined, "Action")} value={telemetry.action} />
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
