#[path = "../../singleplayer/breakout/frame.rs"]
mod breakout;
mod config;
mod engine;
mod frame;
#[path = "../../multiplayer/ice_hockey/view.rs"]
mod ice_hockey;
mod models;
#[path = "../../multiplayer/pong/frame.rs"]
mod pong;
mod scoring;
mod selection;
mod tracking;
mod types;
mod view;
pub use engine::*;
pub use frame::*;
pub use models::{CheckpointFormat, checkpoint_to_onnx};
pub use scoring::*;
pub use selection::*;
pub use tracking::*;
pub use types::*;
pub use view::*;

#[derive(Debug, thiserror::Error)]
pub enum ArenaError {
    #[error("Invalid configuration: {0}")]
    Configuration(String),
    #[error("Invalid request: {0}")]
    Request(String),
    #[error("Invalid emulator output: {0}")]
    Emulator(String),
    #[error("Inference failed: {0}")]
    Inference(String),
    #[error("Runtime failed: {0}")]
    Host(String),
}
pub type Result<T> = std::result::Result<T, ArenaError>;
