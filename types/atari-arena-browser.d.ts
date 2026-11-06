export interface GameSocket {
  readonly readyState: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;

  send(data: string): void;
  close(): void;

  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;

  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
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

export class BrowserRuntime {
  constructor(options: RuntimeOptions);

  request(path: string, init?: RequestInit): Promise<Response>;
  openSocket(): GameSocket;
  dispose(): void;
}
