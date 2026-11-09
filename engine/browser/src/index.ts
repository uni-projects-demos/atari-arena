import type { Catalog } from "./generated/index";
import {
  type GameSocket,
  messageOf,
  type NamedModel,
  type RpcRequest,
  type RpcResult,
  type RuntimeOptions,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";

export type { GameSocket, RuntimeOptions } from "./protocol";

interface Pending {
  resolve: (val: RpcResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BrowserRuntime {
  private readonly worker: Worker;
  private readonly ready: Promise<void>;
  private readonly pending = new Map<number, Pending>();
  private readonly sockets = new Map<number, LocalSocket>();
  private nextId = 1;
  private closed = false;
  private failure: Error | null = null;

  constructor(private readonly opts: RuntimeOptions) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });

    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error("Browser runtime initialization timed out");
        reject(err);
        this.fail(err);
      }, 60_000);

      this.worker.onmessage = ({
        data,
      }: MessageEvent<WorkerResponse>): void => {
        if (data.type === "ready") {
          clearTimeout(timer);
          resolve();
        } else if (data.type === "fatal") {
          clearTimeout(timer);
          const err = new Error(data.message);
          reject(err);
          this.fail(err);
        } else {
          this.receive(data);
        }
      };

      this.worker.onerror = (evt): void => {
        clearTimeout(timer);
        const err = new Error(evt.message || "Worker failed");
        reject(err);
        this.fail(err);
      };
    });

    void this.ready.catch(() => undefined);
    this.post({ type: "init", options: opts });
  }

  async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      if (path === "/api/info" && (!init?.method || init.method === "GET")) {
        return json(await this.call({ type: "catalog" }));
      }

      if (init?.method !== "POST" || !(init.body instanceof FormData)) {
        return json({ detail: "Unsupported browser request" }, 400);
      }

      const form = init.body;
      const game = field(form, "game");

      if (path === "/api/models/load") {
        return json(
          await this.call({
            type: "load",
            game,
            model: field(form, "model"),
          }),
        );
      }

      if (path === "/api/models/upload") {
        const file = form.get("file");

        if (!(file instanceof File)) {
          throw new Error("A model file is required");
        }

        if (file.size > (this.opts.maxModelBytes ?? 100 * 1024 * 1024)) {
          throw new Error("Model exceeds upload size limit");
        }

        if (!file.name.toLowerCase().endsWith(".onnx")) {
          throw new Error(
            "Browser mode accepts .onnx policies. Export .zip/.pt/.pth first, or use Python mode.",
          );
        }

        return json(
          await this.call({
            type: "upload",
            game,
            filename: file.name,
            bytes: await file.arrayBuffer(),
          }),
        );
      }

      return json({ detail: "Unknown browser API route" }, 404);
    } catch (err: unknown) {
      return json({ detail: messageOf(err) }, 400);
    }
  }

  openSocket(): GameSocket {
    if (this.closed || this.failure) {
      throw this.failure ?? new Error("Runtime is closed");
    }

    const id = this.nextId++;

    const sock = new LocalSocket(
      (json) => this.post({ type: "command", socket: id, json }),
      () => {
        this.post({ type: "close", socket: id });
        this.sockets.delete(id);
      },
    );

    this.sockets.set(id, sock);

    void this.ready
      .then(() => {
        if (sock.readyState === 0) {
          this.post({ type: "open", socket: id });
        }
      })
      .catch((err: unknown) => sock.fail(messageOf(err)));

    return sock;
  }

  dispose(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.post({ type: "dispose" });
    this.fail(new Error("Runtime was disposed"));
  }

  private async call(req: RpcRequest): Promise<RpcResult> {
    await this.ready;

    if (this.closed || this.failure) {
      throw this.failure ?? new Error("Runtime is closed");
    }

    if (this.pending.size >= 32) {
      throw new Error("Too many pending requests");
    }

    const id = this.nextId++;

    return new Promise<RpcResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Model/runtime request timed out"));
      }, 120_000);

      this.pending.set(id, { resolve, reject, timer });

      this.post(
        { type: "rpc", id, request: req },
        req.type === "upload" ? [req.bytes] : [],
      );
    });
  }

  private receive(data: WorkerResponse): void {
    if (data.type === "rpc" || data.type === "rpc_error") {
      const p = this.pending.get(data.id);

      if (!p) {
        return;
      }

      clearTimeout(p.timer);
      this.pending.delete(data.id);

      if (data.type === "rpc") {
        p.resolve(data.result);
      } else {
        p.reject(new Error(data.message));
      }

      return;
    }

    if (!("socket" in data)) {
      return;
    }

    const socket = this.sockets.get(data.socket);

    if (!socket) {
      return;
    }

    switch (data.type) {
      case "open":
        socket.open();
        break;

      case "close":
        socket.finish();
        this.sockets.delete(data.socket);
        break;

      case "started":
        socket.emit(JSON.stringify(data.metadata));
        break;

      case "error":
        socket.fail(data.message);
        this.sockets.delete(data.socket);
        break;

      case "frame":
        socket.emit(JSON.stringify(data.metadata));
        socket.emit(data.pixels);

        requestAnimationFrame(() => {
          if (!this.closed && socket.readyState === 1) {
            this.post({ type: "ack", socket: data.socket });
          }
        });

        break;
    }
  }

  private post(
    msg: WorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    this.worker.postMessage(msg, transfer);
  }

  private fail(err: Error): void {
    this.failure = err;

    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }

    this.pending.clear();

    for (const socket of this.sockets.values()) {
      socket.fail(err.message);
    }

    this.sockets.clear();
    this.worker.terminate();
  }
}

class LocalSocket implements GameSocket {
  readyState = 0;
  binaryType: BinaryType = "arraybuffer";
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  private readonly events = new EventTarget();

  constructor(
    private readonly sendCommand: (json: string) => void,
    private readonly disconnect: () => void,
  ) {}

  open(): void {
    if (this.readyState === 0) {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    }
  }

  send(data: string): void {
    if (this.readyState !== 1) {
      throw new DOMException("Socket is not open", "InvalidStateError");
    }

    this.sendCommand(data);
  }

  close(): void {
    if (this.readyState < 2) {
      this.readyState = 2;
      this.disconnect();
      this.finish();
    }
  }

  finish(): void {
    if (this.readyState !== 3) {
      this.readyState = 3;
      this.onclose?.(
        new CloseEvent("close", {
          code: 1000,
          wasClean: true,
        }),
      );
    }
  }

  fail(msg: string): void {
    this.emit(JSON.stringify({ type: "error", message: msg }));
    this.finish();
  }

  emit(data: string | ArrayBuffer): void {
    this.events.dispatchEvent(new MessageEvent("message", { data }));
  }

  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void {
    this.events.addEventListener(type, listener as EventListener);
  }

  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void {
    this.events.removeEventListener(type, listener as EventListener);
  }
}

function field(form: FormData, name: string): string {
  const val = form.get(name);

  if (typeof val !== "string" || !val) {
    throw new Error(`Missing ${name}`);
  }

  return val;
}

function json(
  val: Catalog | NamedModel | { detail: string },
  status = 200,
): Response {
  return new Response(JSON.stringify(val), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
