/* tslint:disable */
/* eslint-disable */

import type {Manifest,StartRequest,StartedMetadata,Direction,FramePacket,Catalog,ClientMessage,EnvironmentConfig,ModelSpec,Observation,Side,Transition,CheckpointFormat} from "../generated/index";
export interface RuntimeHost {
    configure(config:EnvironmentConfig):Promise<void>;
    reset(side:Side|null):Promise<Observation>;
    act(actions:Uint32Array):Promise<Transition>;
    predict(model:ModelSpec,values:Float32Array,dimensions:Uint32Array):Promise<number>;
}



export class Session {
    free(): void;
    [Symbol.dispose](): void;
    input(d: Direction): void;
    constructor(host: RuntimeHost, manifest: Manifest, request: StartRequest);
    reset(): Promise<void>;
    start(): Promise<StartedMetadata>;
    step(): Promise<FramePacket>;
}

export function catalog(m: Manifest): Catalog;

export function checkpoint_to_onnx(bytes: Uint8Array | number[], format: CheckpointFormat, actions: number): Uint8Array;

export function parse_message(json: string): ClientMessage;

export function validate_manifest(json: string): Manifest;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_session_free: (a: number, b: number) => void;
    readonly catalog: (a: any) => [number, number, number];
    readonly checkpoint_to_onnx: (a: number, b: number, c: any, d: number) => [number, number, number, number];
    readonly parse_message: (a: number, b: number) => [number, number, number];
    readonly session_input: (a: number, b: any) => [number, number];
    readonly session_new: (a: any, b: any, c: any) => [number, number, number];
    readonly session_reset: (a: number) => any;
    readonly session_start: (a: number) => any;
    readonly session_step: (a: number) => any;
    readonly validate_manifest: (a: number, b: number) => [number, number, number];
    readonly wasm_bindgen_dd7aca8965e30541___convert__closures_____invoke___js_sys_bbd881fa9aed06d9___Function_fn_wasm_bindgen_dd7aca8965e30541___JsValue_____wasm_bindgen_dd7aca8965e30541___sys__Undefined___js_sys_bbd881fa9aed06d9___Function_fn_wasm_bindgen_dd7aca8965e30541___JsValue_____wasm_bindgen_dd7aca8965e30541___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_dd7aca8965e30541___convert__closures_____invoke___wasm_bindgen_dd7aca8965e30541___JsValue__core_608f92abc48d28da___result__Result_____wasm_bindgen_dd7aca8965e30541___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
