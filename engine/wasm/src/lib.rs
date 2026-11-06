use arena_core::{
    ArenaError, Catalog, CheckpointFormat, ClientMessage, Direction, Engine, EnvironmentConfig,
    FramePacket, Host, Manifest, ModelSpec, Observation, Result, Side, StartRequest,
    StartedMetadata, Transition,
};
use js_sys::{Float32Array, Promise, Uint32Array};
use serde::{Serialize, de::DeserializeOwned};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

type JsResult<T> = std::result::Result<T, JsValue>;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "RuntimeHost")]
    pub type BrowserHost;
    #[wasm_bindgen(method,catch,js_name=configure)]
    fn configure_js(this: &BrowserHost, config: &JsValue) -> JsResult<Promise>;
    #[wasm_bindgen(method,catch,js_name=reset)]
    fn reset_js(this: &BrowserHost, side: &JsValue) -> JsResult<Promise>;
    #[wasm_bindgen(method,catch,js_name=act)]
    fn act_js(this: &BrowserHost, actions: &Uint32Array) -> JsResult<Promise>;
    #[wasm_bindgen(method,catch,js_name=predict)]
    fn predict_js(
        this: &BrowserHost,
        model: &JsValue,
        values: &Float32Array,
        dims: &Uint32Array,
    ) -> JsResult<Promise>;
}
#[wasm_bindgen(typescript_custom_section)]
const HOST_TYPES: &str = r#"
import type {Manifest,StartRequest,StartedMetadata,Direction,FramePacket,Catalog,ClientMessage,EnvironmentConfig,ModelSpec,Observation,Side,Transition,CheckpointFormat} from "../generated/index";
export interface RuntimeHost {
configure(config:EnvironmentConfig):Promise<void>;
reset(side:Side|null):Promise<Observation>;
act(actions:Uint32Array):Promise<Transition>;
predict(model:ModelSpec,values:Float32Array,dimensions:Uint32Array):Promise<number>;
}
"#;

struct HostBridge {
    host: BrowserHost,
}
impl HostBridge {
    async fn resolve<T: DeserializeOwned>(promise: JsResult<Promise>) -> Result<T> {
        let value: JsValue = Self::complete(promise).await?;
        decode(value)
    }
    async fn complete(promise: JsResult<Promise>) -> Result<JsValue> {
        JsFuture::from(promise.map_err(host_error)?)
            .await
            .map_err(host_error)
    }
}
impl Host for HostBridge {
    async fn configure(&mut self, cfg: &EnvironmentConfig) -> Result<()> {
        Self::complete(self.host.configure_js(&encode(cfg)?)).await?;
        Ok(())
    }
    async fn reset(&mut self, side: Option<Side>) -> Result<Observation> {
        Self::resolve(self.host.reset_js(&encode(&side)?)).await
    }
    async fn act(&mut self, actions: &[u32]) -> Result<Transition> {
        Self::resolve(self.host.act_js(&Uint32Array::from(actions))).await
    }
    async fn predict(
        &mut self,
        model: &ModelSpec,
        values: &[f32],
        dimensions: [u32; 4],
    ) -> Result<u32> {
        let value: JsValue = Self::complete(self.host.predict_js(
            &encode(model)?,
            &Float32Array::from(values),
            &Uint32Array::from(dimensions.as_slice()),
        ))
        .await?;
        let action: f64 = value
            .as_f64()
            .filter(|value: &f64| {
                value.is_finite()
                    && *value >= 0.0
                    && *value <= f64::from(u32::MAX)
                    && value.fract() == 0.0
            })
            .ok_or_else(|| ArenaError::Inference("Expected an integer action".into()))?;
        Ok(action as u32)
    }
}
#[wasm_bindgen]
pub struct Session {
    engine: Engine<HostBridge>,
    seed: u32,
}
#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(constructor)]
    pub fn new(
        host: BrowserHost,
        #[wasm_bindgen(unchecked_param_type = "Manifest")] manifest: JsValue,
        #[wasm_bindgen(unchecked_param_type = "StartRequest")] request: JsValue,
    ) -> JsResult<Session> {
        let manifest: Manifest = decode(manifest).map_err(js_error)?;
        let req: StartRequest = decode(request).map_err(js_error)?;
        Ok(Self {
            engine: Engine::new(HostBridge { host }, &manifest, &req).map_err(js_error)?,
            seed: req.seed,
        })
    }
    #[wasm_bindgen(unchecked_return_type = "StartedMetadata")]
    pub async fn start(&mut self) -> JsResult<JsValue> {
        let started: StartedMetadata = self.engine.start(self.seed).await.map_err(js_error)?;
        encode(&started).map_err(js_error)
    }
    #[wasm_bindgen(unchecked_return_type = "FramePacket")]
    pub async fn step(&mut self) -> JsResult<JsValue> {
        let packet: FramePacket = self.engine.step().await.map_err(js_error)?;
        encode(&packet).map_err(js_error)
    }
    pub async fn reset(&mut self) -> JsResult<()> {
        self.engine.reset().await.map_err(js_error)
    }
    pub fn input(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Direction")] d: JsValue,
    ) -> JsResult<()> {
        let direction: Direction = decode(d).map_err(js_error)?;
        self.engine.input(direction);
        Ok(())
    }
}
#[wasm_bindgen(unchecked_return_type = "Manifest")]
pub fn validate_manifest(json: &str) -> JsResult<JsValue> {
    let manifest: Manifest = serde_json::from_str(json).map_err(|error: serde_json::Error| {
        js_error(ArenaError::Configuration(error.to_string()))
    })?;
    manifest.validate().map_err(js_error)?;
    encode(&manifest).map_err(js_error)
}
#[wasm_bindgen(unchecked_return_type = "Catalog")]
pub fn catalog(#[wasm_bindgen(unchecked_param_type = "Manifest")] m: JsValue) -> JsResult<JsValue> {
    let manifest: Manifest = decode(m).map_err(js_error)?;
    manifest.validate().map_err(js_error)?;
    let catalog: Catalog = manifest.catalog();
    encode(&catalog).map_err(js_error)
}
#[wasm_bindgen(unchecked_return_type = "ClientMessage")]
pub fn parse_message(json: &str) -> JsResult<JsValue> {
    let msg: ClientMessage = serde_json::from_str(json)
        .map_err(|error: serde_json::Error| js_error(ArenaError::Request(error.to_string())))?;
    encode(&msg).map_err(js_error)
}
#[wasm_bindgen]
pub fn checkpoint_to_onnx(
    bytes: &[u8],
    #[wasm_bindgen(unchecked_param_type = "CheckpointFormat")] format: JsValue,
    actions: u32,
) -> JsResult<Vec<u8>> {
    let format: CheckpointFormat = decode(format).map_err(js_error)?;
    arena_core::checkpoint_to_onnx(bytes, format, actions).map_err(js_error)
}
fn encode<T: Serialize>(value: &T) -> Result<JsValue> {
    value
        .serialize(
            &serde_wasm_bindgen::Serializer::new()
                .serialize_maps_as_objects(true)
                .serialize_missing_as_null(true),
        )
        .map_err(|error: serde_wasm_bindgen::Error| ArenaError::Host(error.to_string()))
}
fn decode<T: DeserializeOwned>(value: JsValue) -> Result<T> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|error: serde_wasm_bindgen::Error| ArenaError::Host(error.to_string()))
}
fn host_error(error: JsValue) -> ArenaError {
    let msg: String = error
        .as_string()
        .or_else(|| {
            js_sys::Reflect::get(&error, &JsValue::from_str("message"))
                .ok()
                .and_then(|value: JsValue| value.as_string())
        })
        .unwrap_or_else(|| format!("{error:?}"));
    ArenaError::Host(msg)
}
fn js_error(error: ArenaError) -> JsValue {
    js_sys::Error::new(&error.to_string()).into()
}
