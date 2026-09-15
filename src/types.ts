export type MatchModeKey = string;
export type MatchSide = "model" | "user" | "game";
export type UserControlDir =
  | "up"
  | "down"
  | "left"
  | "right"
  | "fire"
  | "up_fire"
  | "down_fire"
  | "none";

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
  default_model_ii?: boolean;
}

export interface UserControls {
  move: string | null;
  fire: string | null;
}

export interface PlayerSlot {
  key: string;
  player_type: "human" | "model";
  mirror?: boolean;
  side?: "left" | "right" | null;
}

export interface MatchMode extends MatchLabels {
  key: MatchModeKey;
  is_user: boolean;
  user_controls: UserControls | null;
  available: boolean;
  error: string | null;
  players?: PlayerSlot[];
}

export interface GameInfo {
  key: string;
  label: string;
  description: string;
  modes: MatchMode[];
  models: ModelInfo[];
  max_players?: number;
  supports_multiplayer?: boolean;
}

export interface ModeCatalog {
  key: MatchModeKey;
  playableGames: number;
  left: MatchSide;
  right: MatchSide;
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
      model?: string;
      players?: {
        slot: string;
        type: "human" | "model";
        model?: string;
      }[];
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
  player_actions?: Record<string, number>;
  player_action_names?: Record<string, string>;
}

export type MsgServer =
  | {
      type: "started";
      game?: string;
      mode?: MatchModeKey;
      profile?: string;
      players?: {
        slot: string;
        type: "human" | "model";
        model?: string | null;
        side?: "left" | "right" | null;
      }[];
    }
  | { type: "error"; message?: string }
  | MsgFrame;
