import { Application, BufferImageSource, type Renderer, Sprite, Texture } from "pixi.js";
import {
  type ForwardedRef,
  type ForwardRefExoticComponent,
  forwardRef,
  type JSX,
  type ReactNode,
  type RefAttributes,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { MsgFrame, MsgServer } from "@/types";
import { type PaddleColors, stylePongFrame } from "./gamePong";

const DEFAULT_WIDTH: number = 160;
const DEFAULT_HEIGHT: number = 210;
const BYTES_PER_PIXEL: number = 4;
const POOL_SIZE: number = 2;

type HandlerJSON = (msg: MsgServer) => void;

interface TexturePoolEntry {
  resource: Uint8Array;
  source: BufferImageSource;
  texture: Texture;
}

interface GameProps {
  overlay?: ReactNode;
  paddleColors?: PaddleColors | null;
}

export interface GameHandle {
  clear: () => void;
  attachSocket: (socket: WebSocket, onJson: HandlerJSON) => (() => void) | null;
  detachSocket: () => void;
}

export class ViewportManager {
  private app: Application<Renderer> | null = null;
  private pendingFrame: MsgFrame | null = null;
  private pool: TexturePoolEntry[] = [];
  private poolIdx: number = -1;
  private resizeObs: ResizeObserver | null = null;
  private sprite: Sprite | null = null;
  private socketBinding: {
    socket: WebSocket;
    onMsg: (event: MessageEvent) => void;
  } | null = null;
  private width: number = DEFAULT_WIDTH;
  private height: number = DEFAULT_HEIGHT;
  private isDestroyed: boolean = false;
  private paddleColors: PaddleColors | null = null;

  readonly ready: Promise<void>;

  constructor(private readonly host: HTMLElement) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const app: Application = new Application<Renderer>();
    await app.init({
      background: "#000000",
      antialias: false,
      autoDensity: false,
      resolution: 1,
      resizeTo: this.host,
      preference: "webgl",
      autoStart: false,
    });

    if (this.isDestroyed) {
      app.destroy(true);
      return;
    }

    this.sprite = new Sprite();
    this.sprite.visible = false;

    this.app = app;
    app.canvas.className = "pixi-canvas";
    app.stage.addChild(this.sprite);
    this.host.appendChild(app.canvas);

    this.resizeObs = new ResizeObserver((): number =>
      requestAnimationFrame((): void => this.resize()),
    );
    this.resizeObs.observe(this.host);
    this.resize();
  }

  resize(): void {
    if (!this.app || !this.sprite) return;
    this.app.resize();

    const scale: number = Math.max(
      1,
      Math.floor(
        Math.min(this.app.screen.width / this.width, this.app.screen.height / this.height),
      ),
    );

    this.sprite.scale.set(scale);
    this.sprite.x = Math.round((this.app.screen.width - this.width * scale) / 2);
    this.sprite.y = Math.round((this.app.screen.height - this.height * scale) / 2);

    this.app.render();
  }

  setPaddleColors(colors: PaddleColors | null): void {
    this.paddleColors = colors;
  }

  private destroyPool(): void {
    for (const { texture } of this.pool) {
      texture.destroy(true);
    }
    this.pool = [];
    this.poolIdx = -1;
  }

  private ensurePool(width: number, height: number): void {
    if (this.pool.length && this.width === width && this.height === height) {
      return;
    }

    this.destroyPool();

    this.width = width;
    this.height = height;

    const byteLen: number = width * height * BYTES_PER_PIXEL;

    this.pool = Array.from(
      { length: POOL_SIZE },
      (): {
        resource: Uint8Array<ArrayBuffer>;
        source: BufferImageSource;
        texture: Texture<BufferImageSource>;
      } => {
        const resource: Uint8Array<ArrayBuffer> = new Uint8Array(byteLen);
        const source: BufferImageSource = new BufferImageSource({
          resource,
          width,
          height,
          format: "rgba8unorm",
        });
        source.scaleMode = "nearest";

        return {
          resource,
          source,
          texture: new Texture({ source }),
        };
      },
    );

    this.resize();
  }

  private async drawFrame(buffer: ArrayBuffer, frame: MsgFrame | null): Promise<void> {
    await this.ready;

    if (this.isDestroyed || !this.app || !this.sprite || !frame) return;

    const width: number = frame.width || DEFAULT_WIDTH;
    const height: number = frame.height || DEFAULT_HEIGHT;
    const expectedLen: number = width * height * BYTES_PER_PIXEL;

    if (buffer.byteLength !== expectedLen) {
      throw new Error(`Frame size mismatch: expected ${expectedLen}, got ${buffer.byteLength}`);
    }

    this.ensurePool(width, height);
    this.poolIdx = (this.poolIdx + 1) % this.pool.length;

    const entry: TexturePoolEntry = this.pool[this.poolIdx];
    entry.resource.set(new Uint8Array(buffer));
    if (this.paddleColors) {
      stylePongFrame(entry.resource, width, height, this.paddleColors);
    }
    entry.source.update();

    this.sprite.texture = entry.texture;
    this.sprite.visible = true;

    this.app.render();
  }

  attachSocket(socket: WebSocket, onJson: HandlerJSON): () => void {
    this.detachSocket();

    socket.binaryType = "arraybuffer";

    const onMsg: (event: MessageEvent) => void = (event: MessageEvent): void => {
      if (typeof event.data === "string") {
        const msg: MsgServer = JSON.parse(event.data) as MsgServer;
        if (msg.type === "frame") {
          this.pendingFrame = msg;
        }
        onJson(msg);
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        const frame: MsgFrame | null = this.pendingFrame;
        this.pendingFrame = null;
        void this.drawFrame(event.data, frame);
      }
    };

    socket.addEventListener("message", onMsg);
    this.socketBinding = { socket, onMsg };

    return (): void => this.detachSocket();
  }

  detachSocket(): void {
    const binding: {
      socket: WebSocket;
      onMsg: (event: MessageEvent) => void;
    } | null = this.socketBinding;
    if (!binding) return;
    binding.socket.removeEventListener("message", binding.onMsg);

    this.socketBinding = null;
    this.pendingFrame = null;
  }

  clear(): void {
    this.pendingFrame = null;

    if (!this.app || !this.sprite) return;

    this.sprite.visible = false;
    this.app.render();
  }

  destroy(): void {
    this.isDestroyed = true;

    this.detachSocket();
    this.resizeObs?.disconnect();
    this.destroyPool();
    this.app?.destroy(true, { children: true });

    this.app = null;
    this.sprite = null;
    this.resizeObs = null;
  }
}

export const Game: ForwardRefExoticComponent<GameProps & RefAttributes<GameHandle>> = forwardRef<
  GameHandle,
  GameProps
>(function PixiGame(
  { overlay, paddleColors }: GameProps,
  ref: ForwardedRef<GameHandle>,
): JSX.Element {
  const hostRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const managerRef: RefObject<ViewportManager | null> = useRef<ViewportManager>(null);

  useEffect((): (() => void) | undefined => {
    const host: HTMLDivElement | null = hostRef.current;
    if (!host) return;

    const manager: ViewportManager = new ViewportManager(host);
    managerRef.current = manager;
    return (): void => {
      managerRef.current = null;
      manager.destroy();
    };
  }, []);

  useEffect((): void => {
    managerRef.current?.setPaddleColors(paddleColors ?? null);
  }, [paddleColors]);

  useImperativeHandle(
    ref,
    (): {
      clear: () => void;
      attachSocket: (socket: WebSocket, onJson: HandlerJSON) => (() => void) | null;
      detachSocket: () => void;
    } => ({
      clear: (): void => managerRef.current?.clear(),
      attachSocket: (socket: WebSocket, onJson: HandlerJSON): (() => void) | null =>
        managerRef.current?.attachSocket(socket, onJson) ?? null,
      detachSocket: (): void => managerRef.current?.detachSocket(),
    }),
    [],
  );

  return (
    <div ref={hostRef} className="pixi-shell">
      {overlay && <div className="pixi-overlay">{overlay}</div>}
    </div>
  );
});
