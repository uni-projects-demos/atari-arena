import type { InferenceSession, Tensor } from "onnxruntime-web";
import type { CheckpointFormat, Manifest, ModelSpec } from "./generated/index";
import { gameFrom, modelFrom, type NamedModel, type RuntimeOptions } from "./protocol";

type Ort = typeof import("onnxruntime-web");

interface CachedSession {
  promise: Promise<InferenceSession>;
  leases: number;
  accessed: number;
}

export class ModelStore {
  private readonly sessions = new Map<string, CachedSession>();
  private readonly uploads = new Map<string, ArrayBuffer>();
  private ort: Promise<Ort> | null = null;
  private access = 0;

  constructor(
    private readonly manifest: Manifest,
    private readonly manifestUrl: string,
    private readonly opts: RuntimeOptions,
    private readonly convertCheckpoint: (
      bytes: Uint8Array,
      fmt: CheckpointFormat,
      nActions: number,
    ) => Uint8Array,
  ) {}

  async load(game: string, id: string): Promise<NamedModel> {
    const model = modelFrom(this.manifest, game, id);

    if (model.policy.type === "onnx") {
      const i = model.input;

      await this.use(game, model, (s) =>
        this.infer(s, model, new Float32Array(i.width * i.height * i.history), [
          1,
          i.history,
          i.height,
          i.width,
        ]),
      );
    }

    return { id: model.id, name: model.name };
  }

  async upload(
    gameKey: string,
    filename: string,
    bytes: ArrayBuffer,
  ): Promise<NamedModel> {
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > (this.opts.maxModelBytes ?? 100 * 1024 * 1024)
    ) {
      throw new Error("Invalid model file size");
    }

    if (!filename.toLowerCase().endsWith(".onnx")) {
      throw new Error("Browser mode requires an exported .onnx policy");
    }

    const uploadedBytes = Array.from(this.uploads.values()).reduce(
      (sum, val) => sum + val.byteLength,
      0,
    );

    if (
      uploadedBytes + bytes.byteLength >
      (this.opts.maxUploadedBytes ?? 128 * 1024 * 1024)
    ) {
      throw new Error(
        "Uploaded model memory budget exceeded; reload to release local uploads",
      );
    }

    const game = gameFrom(this.manifest, gameKey);
    const id = `upload-${crypto.randomUUID()}`;

    const model: ModelSpec = {
      id,
      name: filename.replace(/\.onnx$/i, ""),
      policy: {
        type: "onnx",
        url: `memory:${id}`,
        input_name: "observation",
        output_name: "action",
        output: "action",
      },
      n_actions: game.action_names.length,
      profile: game.default_profile,
      input: {
        ...((game.models.find((model) => model.default) ?? game.models[0])
          ?.input ?? {
          width: 84,
          height: 84,
          history: 4,
          scale: 1,
          padding: "zero",
          grayscale_order: "before_resize",
        }),
      },
      uploaded: true,
      default: false,
      default_model_ii: false,
    };

    const key = cacheKey(gameKey, id);

    this.uploads.set(key, bytes);
    game.models.push(model);

    try {
      return await this.load(gameKey, id);
    } catch (err: unknown) {
      game.models = game.models.filter((m) => m.id !== id);
      this.uploads.delete(key);

      const session = this.sessions.get(key);
      this.sessions.delete(key);

      if (session) {
        await session.promise
          .then((s) => s.release())
          .catch(() => undefined);
      }

      throw err;
    }
  }

  async predict(
    game: string,
    model: ModelSpec,
    vals: Float32Array,
    dims: Uint32Array,
  ): Promise<number> {
    return this.use(game, model, (session) =>
      this.infer(session, model, vals, Array.from(dims)),
    );
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.sessions.values(), async (s) =>
        (await s.promise).release(),
      ),
    );

    this.sessions.clear();
    this.uploads.clear();
  }

  private async initialize(): Promise<Ort> {
    const ort = await (this.opts.executionProvider === "webgpu"
      ? import("onnxruntime-web/webgpu")
      : import("onnxruntime-web/wasm"));

    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = this.opts.ortUrl;

    return ort;
  }

  private runtime(): Promise<Ort> {
    this.ort ??= this.initialize();
    return this.ort;
  }

  private async use<T>(
    game: string,
    model: ModelSpec,
    op: (session: InferenceSession) => Promise<T>,
  ): Promise<T> {
    const entry = this.acquire(game, model);
    entry.leases++;

    try {
      return await op(await entry.promise);
    } finally {
      entry.leases--;
    }
  }

  private acquire(game: string, model: ModelSpec): CachedSession {
    const key = cacheKey(game, model.id);
    const cached = this.sessions.get(key);

    if (cached) {
      cached.accessed = ++this.access;
      return cached;
    }

    if (this.sessions.size >= (this.opts.maxCachedModels ?? 8)) {
      const cand = Array.from(this.sessions)
        .filter(([, val]) => val.leases === 0)
        .sort((a, b) => a[1].accessed - b[1].accessed)[0];

      if (!cand) {
        throw new Error(
          "All cached models are busy; increase maxCachedModels or reduce concurrent sessions",
        );
      }

      this.sessions.delete(cand[0]);

      void cand[1].promise
        .then((sess) => sess.release())
        .catch(() => undefined);
    }

    const promise = this.create(game, model).catch((err: unknown) => {
      this.sessions.delete(key);
      throw err;
    });

    const entry = {
      promise,
      leases: 0,
      accessed: ++this.access,
    };

    this.sessions.set(key, entry);

    return entry;
  }

  private async create(
    game: string,
    model: ModelSpec,
  ): Promise<InferenceSession> {
    if (model.policy.type !== "onnx") {
      throw new Error("Expected an ONNX policy");
    }

    const ort = await this.runtime();
    let bytes = this.uploads.get(cacheKey(game, model.id));

    if (!bytes) {
      const res = await fetch(new URL(model.policy.url, this.manifestUrl));

      if (!res.ok) {
        throw new Error(
          `Could not download ${model.name}: HTTP ${res.status}. Check network access and the model URL.`,
        );
      }

      const maxBytes = this.opts.maxModelBytes ?? 100 * 1024 * 1024;

      if (Number(res.headers.get("Content-Length")) > maxBytes) {
        throw new Error("Model exceeds size limit");
      }

      bytes = await res.arrayBuffer();

      if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
        throw new Error("Invalid model size");
      }
    }

    if (model.policy.sha256) {
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );

      const hash = Array.from(digest, (val) =>
        val.toString(16).padStart(2, "0"),
      ).join("");

      if (hash !== model.policy.sha256.toLowerCase()) {
        throw new Error(`Checksum verification failed for ${model.name}`);
      }
    }

    const policyBytes = model.policy.format
      ? this.convertCheckpoint(
          new Uint8Array(bytes),
          model.policy.format,
          model.n_actions,
        )
      : new Uint8Array(bytes);

    const session = await ort.InferenceSession.create(policyBytes, {
      executionProviders:
        this.opts.executionProvider === "webgpu"
          ? ["webgpu", "wasm"]
          : ["wasm"],
      graphOptimizationLevel: "all",
    });

    if (
      session.inputNames.length !== 1 ||
      !session.inputNames.includes(model.policy.input_name) ||
      !session.outputNames.includes(model.policy.output_name)
    ) {
      await session.release();

      throw new Error(
        `Model must expose input '${model.policy.input_name}' and output '${model.policy.output_name}'`,
      );
    }

    return session;
  }

  private async infer(
    session: InferenceSession,
    model: ModelSpec,
    vals: Float32Array,
    dims: readonly number[],
  ): Promise<number> {
    if (model.policy.type !== "onnx") {
      throw new Error("Expected an ONNX policy");
    }

    const ort = await this.runtime();

    const outputs = await session.run({
      [model.policy.input_name]: new ort.Tensor("float32", vals, dims),
    });

    const tensor: Tensor | undefined = outputs[model.policy.output_name];

    if (!tensor) {
      throw new Error("Model output is missing");
    }

    const data = tensor.data;
    let action: number;

    if (model.policy.output === "action") {
      if (data.length !== 1) {
        throw new Error("Expected one discrete action");
      }

      action = Number(data[0]);
    } else {
      if (data.length !== model.n_actions) {
        throw new Error("Model score count does not match the game");
      }

      action = 0;

      for (let i = 0; i < data.length; i++) {
        if (!Number.isFinite(Number(data[i]))) {
          throw new Error("Non-finite model scores");
        }

        if (Number(data[i]) > Number(data[action])) {
          action = i;
        }
      }
    }

    if (
      !Number.isInteger(action) ||
      action < 0 ||
      action >= model.n_actions
    ) {
      throw new Error("Model returned an invalid action");
    }

    return action;
  }
}

function cacheKey(game: string, id: string): string {
  return JSON.stringify([game, id]);
}
