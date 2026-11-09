import type {
  Catalog,
  FrameMetadata,
  Manifest,
  ModelSpec,
  StartedMetadata,
} from "./generated/index";

export interface GameSocket {
  readonly readyState: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;

  send(data: string): void;
  close(): void;
  addEventListener(type: "message", listener: (evt: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (evt: MessageEvent) => void): void;
}

export interface RuntimeOptions {
  manifestUrl: string;
  wasmUrl: string;
  ortUrl: string;
  executionProvider?: "wasm" | "webgpu";
  maxModelBytes?: number;
  maxCachedModels?: number;
  maxUploadedBytes?: number;
  maxSessions?: number;
}

export interface NamedModel {
  id: string;
  name: string;
}

export type RpcRequest =
  | { type: "catalog" }
  | { type: "load"; game: string; model: string }
  | { type: "upload"; game: string; filename: string; bytes: ArrayBuffer };

export type RpcResult = Catalog | NamedModel;

export type WorkerRequest =
  | { type: "init"; options: RuntimeOptions }
  | { type: "rpc"; id: number; request: RpcRequest }
  | { type: "open" | "ack" | "close"; socket: number }
  | { type: "command"; socket: number; json: string }
  | { type: "dispose" };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "fatal"; message: string }
  | { type: "rpc"; id: number; result: RpcResult }
  | { type: "rpc_error"; id: number; message: string }
  | { type: "open" | "close"; socket: number }
  | { type: "started"; socket: number; metadata: StartedMetadata }
  | { type: "frame"; socket: number; metadata: FrameMetadata; pixels: ArrayBuffer }
  | { type: "error"; socket: number; message: string };

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function gameFrom(manifest: Manifest, key: string) {
  const game = manifest.games.find((g) => g.key === key);

  if (!game) {
    throw new Error(`Unknown game: ${key}`);
  }

  return game;
}

export function modelFrom(
  manifest: Manifest,
  game: string,
  id: string,
): ModelSpec {
  const model = gameFrom(manifest, game).models.find((m) => m.id === id);

  if (!model) {
    throw new Error(`Unknown model for ${game}: ${id}`);
  }

  return model;
}
