import { applyOpening } from "../../multiplayer/pong/environment";
import type {
  EnvironmentConfig,
  Observation,
  Side,
  Transition,
} from "./generated/index";

export interface Emulator {
  setBool(key: string, val: boolean): void;
  setInt(key: string, val: number): void;
  setFloat(key: string, val: number): void;
  loadROM(path: string): void;
  setMode(mode: number): void;
  resetGame(): void;
  getMinimalActionSet(): number[];
  getScreenRGB(): Uint8Array;
  getScreenWidth(): number;
  getScreenHeight(): number;
  getRAM(): Uint8Array;
  setRAM(idx: number, val: number): void;
  gameOver(): boolean;
  lives(): number;
  delete(): void;
}

interface SingleEmulator extends Emulator {
  act(action: number): number;
}

interface MultiEmulator extends Emulator {
  act(actions: Uint32Array): number[];
  numPlayersActive(): number;
}

interface Module<T extends Emulator> {
  ALEInterface: new () => T;
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
  getExceptionMessage?: (ex: number) => [string, string];
}

type Factory = (opts: {
  locateFile: (name: string) => string;
  print: (msg: string) => void;
  printErr: (msg: string) => void;
}) => Promise<Module<SingleEmulator | MultiEmulator>>;

type Active =
  | { type: "ale"; instance: SingleEmulator }
  | { type: "multi_ale"; instance: MultiEmulator };

export class AtariEnvironment {
  private captureRam = false;
  private active: Active | null = null;
  private actions: number[] = [];
  private mapped = new Uint32Array();
  private pendingOpening = false;

  constructor(
    private readonly manifestUrl: string,
    private readonly aleUrl: string,
    private readonly multiUrl: string,
  ) {}

  async configure(cfg: EnvironmentConfig): Promise<void> {
    this.dispose();
    this.captureRam = cfg.capture_ram;

    const url = new URL(
      cfg.emulator === "ale" ? this.aleUrl : this.multiUrl,
      this.manifestUrl,
    );

    const ns: unknown = await import(/* @vite-ignore */ url.href);

    if (
      typeof ns !== "object" ||
      ns === null ||
      !("default" in ns) ||
      typeof ns.default !== "function"
    ) {
      throw new Error("Invalid emulator module factory");
    }

    const factory = ns.default as Factory;

    const mod = await factory({
      locateFile: (name) => new URL(name, url).href,
      print: () => undefined,
      printErr: (msg) => console.debug(msg),
    });

    const emu = new mod.ALEInterface();

    try {
      emu.setBool("display_screen", false);
      emu.setInt("random_seed", cfg.seed & 0x7fffffff);
      emu.setInt("frame_skip", 1);
      emu.setFloat(
        "repeat_action_probability",
        cfg.repeat_action_prob,
      );

      const res = await fetch(new URL(cfg.rom_url, this.manifestUrl));

      if (!res.ok) {
        throw new Error(
          `Could not load ${cfg.game} ROM: HTTP ${res.status}`,
        );
      }

      const rom = new Uint8Array(await res.arrayBuffer());

      if (rom.length === 0 || rom.length > 1024 * 1024) {
        throw new Error("Invalid Atari ROM size");
      }

      mod.FS.mkdirTree("/arena-roms");
      mod.FS.writeFile("/arena-roms/game.bin", rom);

      emu.loadROM("/arena-roms/game.bin");

      if (cfg.emulator_mode !== null) {
        emu.setMode(cfg.emulator_mode);
      }

      const acts = emu.getMinimalActionSet();

      if (acts.length !== cfg.n_actions) {
        throw new Error(
          `Expected ${cfg.n_actions} actions; got ${acts.length}`,
        );
      }

      if (cfg.emulator === "multi_ale") {
        if (
          !("numPlayersActive" in emu) ||
          typeof emu.numPlayersActive !== "function" ||
          emu.numPlayersActive() !== cfg.player_count
        ) {
          throw new Error(
            "Multi-Agent ALE did not enable the requested player count",
          );
        }

        this.active = {
          type: "multi_ale",
          instance: emu as MultiEmulator,
        };
      } else {
        this.active = {
          type: "ale",
          instance: emu as SingleEmulator,
        };
      }

      this.actions = acts;
      this.mapped = new Uint32Array(cfg.player_count);
    } catch (err: unknown) {
      emu.delete();

      if (typeof err === "number" && mod.getExceptionMessage) {
        throw new Error(mod.getExceptionMessage(err).join(": "));
      }

      throw err;
    }
  }

  async reset(side: Side | null): Promise<Observation> {
    this.requireActive().instance.resetGame();
    this.pendingOpening = side === "right";

    return this.observation();
  }

  async act(idxs: Uint32Array): Promise<Transition> {
    const cur = this.requireActive();

    if (idxs.length !== this.mapped.length) {
      throw new Error("Incorrect player action count");
    }

    const mapped = this.mapped;

    for (let i = 0; i < idxs.length; i++) {
      const action = this.actions[idxs[i]];

      if (action === undefined) {
        throw new Error(`Invalid action index: ${idxs[i]}`);
      }

      mapped[i] = action;
    }

    let rewards: number[];

    if (cur.type === "ale") {
      if (mapped.length !== 1) {
        throw new Error("ALE expects one action");
      }

      rewards = [cur.instance.act(mapped[0])];
    } else {
      rewards = cur.instance.act(mapped);
    }

    if (this.pendingOpening) {
      this.pendingOpening = applyOpening(cur.instance);
    }

    return {
      observation: this.observation(),
      rewards,
      done: cur.instance.gameOver(),
    };
  }

  dispose(): void {
    this.active?.instance.delete();
    this.active = null;
    this.actions = [];
    this.mapped = new Uint32Array();
  }

  private requireActive(): Active {
    if (!this.active) {
      throw new Error("Emulator is not initialized");
    }

    return this.active;
  }

  private observation(): Observation {
    const cur = this.requireActive();
    const e = cur.instance;
    const lives = cur.type === "ale" ? e.lives() : -1;

    return {
      width: e.getScreenWidth(),
      height: e.getScreenHeight(),
      rgb: e.getScreenRGB(),
      lives: lives >= 0 ? lives : null,
      ram: this.captureRam ? e.getRAM() : new Uint8Array(),
    };
  }
}
