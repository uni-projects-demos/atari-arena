import { AtariEnvironment } from "./environment";
import type { Direction, Manifest, ModelSpec, StartRequest } from "./generated/index";
import { ModelStore } from "./models";
import {
  messageOf,
  type RuntimeOptions,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";
import type * as Wasm from "./wasm/arena_wasm";

interface WorkerScope {
  onmessage: ((evt: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void;
  close(): void;
}

const scope = globalThis as unknown as WorkerScope;
const sessions = new Map<number, SessionState>();
const sockets = new Set<number>();

let init: Promise<void> | null = null;
let wasm: typeof Wasm;
let manifest: Manifest;
let models: ModelStore;
let opts: RuntimeOptions;

interface SessionState {
  session: Wasm.Session;
  environment: AtariEnvironment;
  busy: boolean;
  stopped: boolean;
  waiting: boolean;
  reset: boolean;
  direction: Direction;
  deadline: number;
  interval: number;
  timer: ReturnType<typeof setTimeout> | null;
}

scope.onmessage = ({ data: msg }): void => {
  if (msg.kind === "init") {
    if (init) {
      send({ kind: "fatal", message: "Runtime initialized twice" });
      return;
    }

    init = initialize(msg.options).then(() => send({ kind: "ready" }));

    void init.catch((err: unknown) =>
      send({ kind: "fatal", message: messageOf(err) }),
    );
    return;
  }

  void dispatch(msg).catch((err: unknown) => {
    if (msg.kind === "rpc") {
      send({ kind: "rpc_error", id: msg.id, message: messageOf(err) });
    } else if ("socket" in msg) {
      fail(msg.socket, err);
    } else {
      send({ kind: "fatal", message: messageOf(err) });
    }
  });
};

async function initialize(cfg: RuntimeOptions): Promise<void> {
  opts = cfg;

  const ns: unknown = await import(/* @vite-ignore */ cfg.wasmUrl);

  if (
    typeof ns !== "object" ||
    ns === null ||
    !("default" in ns) ||
    typeof ns.default !== "function"
  ) {
    throw new Error("Invalid Rust WASM module");
  }

  wasm = ns as typeof Wasm;
  await wasm.default({
    module_or_path: new URL("arena_wasm_bg.wasm", cfg.wasmUrl),
  });

  const res = await fetch(cfg.manifestUrl);
  if (!res.ok) {
    throw new Error(`Manifest request failed: HTTP ${res.status}`);
  }

  manifest = wasm.validate_manifest(await res.text());
  models = new ModelStore(
    manifest,
    cfg.manifestUrl,
    cfg,
    wasm.checkpoint_to_onnx,
  );
}

async function dispatch(
  msg: Exclude<WorkerRequest, { kind: "init" }>,
): Promise<void> {
  if (!init) {
    throw new Error("Runtime was not initialized");
  }

  await init;

  switch (msg.kind) {
    case "rpc": {
      const req = msg.request;
      const res =
        req.kind === "catalog"
          ? wasm.catalog(manifest)
          : req.kind === "load"
            ? await models.load(req.game, req.model)
            : await models.upload(req.game, req.filename, req.bytes);

      send({ kind: "rpc", id: msg.id, result: res });
      break;
    }

    case "open":
      if (sockets.size >= (opts.maxSessions ?? 4)) {
        throw new Error("Browser session limit reached");
      }

      sockets.add(msg.socket);
      send({ kind: "open", socket: msg.socket });
      break;

    case "command": {
      if (!sockets.has(msg.socket)) {
        throw new Error("Socket is closed");
      }

      const cmd = wasm.parse_message(msg.json);

      if (cmd.type === "start") {
        await start(msg.socket, cmd);
        break;
      }

      const state = sessions.get(msg.socket);
      if (!state) {
        throw new Error("First request message 'type' must be 'start'");
      }

      if (cmd.type === "input") {
        state.direction = cmd.direction;
      } else if (cmd.type === "reset") {
        state.reset = true;
        state.direction = "none";
      } else {
        stop(msg.socket);
      }

      break;
    }

    case "ack": {
      const s = sessions.get(msg.socket);

      if (s?.waiting) {
        s.waiting = false;
        schedule(msg.socket, s);
      }

      break;
    }

    case "close":
      stop(msg.socket);
      break;

    case "dispose":
      for (const id of sockets) {
        stop(id);
      }

      await models.dispose();
      scope.close();
      break;
  }
}

async function start(socket: number, req: StartRequest): Promise<void> {
  if (sessions.has(socket)) {
    throw new Error("Session already started");
  }

  if (req.seed === 0) {
    req.seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  }

  const env = new AtariEnvironment(
    opts.manifestUrl,
    manifest.ale_module,
    manifest.multi_ale_module,
  );

  const host: Wasm.RuntimeHost = {
    configure: (c) => env.configure(c),
    reset: (s) => env.reset(s),
    act: (a) => env.act(a),
    predict: (m: ModelSpec, v, d) => models.predict(req.game, m, v, d),
  };

  const session = new wasm.Session(host, manifest, req);

  const state: SessionState = {
    session,
    environment: env,
    busy: true,
    stopped: false,
    waiting: false,
    reset: false,
    direction: "none",
    deadline: performance.now(),
    interval: 1000 / Math.max(5, Math.min(req.fps, 60)),
    timer: null,
  };

  sessions.set(socket, state);

  try {
    const meta = await session.start();

    if (!state.stopped) {
      send({ kind: "started", socket, metadata: meta });
    }
  } catch (err: unknown) {
    fail(socket, err);
  } finally {
    state.busy = false;

    if (state.stopped) {
      release(socket, state);
    } else {
      schedule(socket, state);
    }
  }
}

function schedule(socket: number, state: SessionState): void {
  if (state.stopped || state.waiting || state.busy || state.timer !== null) {
    return;
  }

  state.timer = setTimeout(
    () => {
      state.timer = null;
      void tick(socket, state);
    },
    Math.max(0, state.deadline - performance.now()),
  );
}

async function tick(socket: number, state: SessionState): Promise<void> {
  if (state.stopped) {
    return;
  }

  state.busy = true;

  try {
    if (state.reset) {
      state.reset = false;
      await state.session.reset();
    }

    state.session.input(state.direction);

    const frame = await state.session.step();
    if (state.stopped) {
      return;
    }

    const px = frame.pixels;

    if (
      !(px instanceof Uint8Array) ||
      !(px.buffer instanceof ArrayBuffer)
    ) {
      throw new Error("Invalid Rust pixel buffer");
    }

    state.waiting = true;
    state.deadline = Math.max(
      state.deadline + state.interval,
      performance.now(),
    );

    send(
      {
        kind: "frame",
        socket,
        metadata: frame.metadata,
        pixels: px.buffer,
      },
      [px.buffer],
    );
  } catch (err: unknown) {
    fail(socket, err);
  } finally {
    state.busy = false;

    if (state.stopped) {
      release(socket, state);
    }
  }
}

function stop(socket: number): void {
  sockets.delete(socket);

  const s = sessions.get(socket);

  if (s) {
    s.stopped = true;

    if (s.timer !== null) {
      clearTimeout(s.timer);
      s.timer = null;
    }

    if (!s.busy) {
      release(socket, s);
    }
  }

  send({ kind: "close", socket });
}

function release(socket: number, state: SessionState): void {
  if (sessions.get(socket) !== state) {
    return;
  }

  state.environment.dispose();
  state.session.free();
  sessions.delete(socket);
}

function fail(socket: number, err: unknown): void {
  send({ kind: "error", socket, message: messageOf(err) });
  stop(socket);
}

function send(
  msg: WorkerResponse,
  transfer: Transferable[] = [],
): void {
  scope.postMessage(msg, transfer);
}
