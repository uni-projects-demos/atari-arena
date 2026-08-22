export type MatchModeKey = "user" | "game";
export type UserControlDir = "up" | "down" | "fire" | "none";

interface MatchLabels {
  left_label: string;
  right_label: string;
}

export interface NamedEntity {
  id: string;
  name: string;
}

export interface ModelInfo extends NamedEntity {
  uploaded: boolean;
  default: boolean;
}

export interface MatchMode extends MatchLabels {
  key: MatchModeKey;
  human_controlled: boolean;
  move: string | null;
  fire: string | null;
  available: boolean;
  error: string | null;
}

export interface GameInfo {
  key: string;
  label: string;
  description: string;
  modes: MatchMode[];
  models: ModelInfo[];
}

export interface ModeCatalog {
  key: MatchModeKey;
  playableGames: number;
}

export interface ResCatalog {
  games: GameInfo[];
}

export interface ResErrAPI {
  detail?: string;
}

export type ResUpload = NamedEntity;

export type MsgClient =
  | {
      type: "start";
      game: string;
      mode: MatchModeKey;
      profile: "auto";
      model: string;
      fps: number;
    }
  | { type: "input"; direction: UserControlDir }
  | { type: "reset" | "stop" };

export interface MsgFrame extends MatchLabels {
  type: "frame";
  width: number;
  height: number;
  left_score: number;
  right_score: number;
  steps: number;
  model_action: number;
  model_action_name: string;
}

export type MsgServer = { type: "started" } | { type: "error"; message?: string } | MsgFrame;
