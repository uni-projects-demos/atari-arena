use crate::{ArenaError, CheckpointFormat, PolicyView, Result, Scoring};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

pub(crate) const DEFAULT_MAX_CYCLES: u32 = 100_000;
const MAX_ACTION_REPEAT: u32 = 60;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Direction {
    #[default]
    None,
    Up,
    Down,
    Left,
    Right,
    Fire,
    UpFire,
    DownFire,
    LeftFire,
    RightFire,
    UpLeft,
    UpRight,
    DownLeft,
    DownRight,
    UpLeftFire,
    UpRightFire,
    DownLeftFire,
    DownRightFire,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum PlayerKind {
    Human,
    Model,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Side {
    Left,
    Right,
}
impl Side {
    pub fn opposite(self) -> Self {
        match self {
            Self::Left => Self::Right,
            Self::Right => Self::Left,
        }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EmulatorKind {
    Ale,
    MultiAle,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct PlayerSlot {
    pub key: String,
    pub player_type: PlayerKind,
    pub side: Side,
    #[serde(default)]
    pub mirror: bool,
    #[serde(default)]
    pub policy_view: Option<PolicyView>,
    pub agent_index: usize,
    #[serde(default)]
    pub action_map: Vec<u32>,
    #[serde(default)]
    pub color_swaps: Vec<ColorSwap>,
}
impl PlayerSlot {
    pub(crate) fn into_human(mut self) -> Self {
        self.player_type = PlayerKind::Human;
        self.policy_view = None;
        self.action_map.clear();
        self.color_swaps.clear();
        self
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct ColorSwap {
    pub first: [u8; 3],
    pub second: [u8; 3],
    #[serde(default)]
    pub region: Option<FrameRect>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ControlLayout {
    Axis,
    Joystick,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct UserControls {
    pub r#move: Option<String>,
    pub fire: Option<String>,
    #[serde(default)]
    pub layout: Option<ControlLayout>,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum FrameSkip {
    Fixed(u32),
    Range([u32; 2]),
}
impl FrameSkip {
    pub(crate) fn is_valid(&self) -> bool {
        match *self {
            Self::Fixed(count) => (1..=MAX_ACTION_REPEAT).contains(&count),
            Self::Range([min, max]) => min > 0 && min < max && max <= MAX_ACTION_REPEAT + 1,
        }
    }
    pub fn bounds(&self) -> (u32, u32) {
        match *self {
            Self::Fixed(count) => (count, count.saturating_add(1)),
            Self::Range([min, max]) => (min, max),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct Profile {
    pub key: String,
    pub label: String,
    pub frame_skip: FrameSkip,
    pub repeat_action_prob: f32,
}
fn max_cycles() -> u32 {
    DEFAULT_MAX_CYCLES
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct FrameRect {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}
impl FrameRect {
    pub fn contains(&self, x: u32, y: u32) -> bool {
        (self.left..self.left + self.width).contains(&x)
            && (self.top..self.top + self.height).contains(&y)
    }
    pub fn validate(&self, width: u32, height: u32) -> Result<()> {
        if self.width == 0
            || self.height == 0
            || !self
                .left
                .checked_add(self.width)
                .is_some_and(|right: u32| right <= width)
            || !self
                .top
                .checked_add(self.height)
                .is_some_and(|bottom: u32| bottom <= height)
        {
            return Err(ArenaError::Configuration(
                "Display region must fit inside the frame".into(),
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct ModeSpec {
    pub key: String,
    pub left_label: String,
    pub right_label: String,
    pub players: Vec<PlayerSlot>,
    pub user_controls: Option<UserControls>,
    pub emulator: EmulatorKind,
    pub scoring: Scoring,
    #[serde(default)]
    pub mirror_frame: bool,
    // Restore readable text after mirroring, without altering policy observations.
    #[serde(default)]
    pub display_unmirror_regions: Vec<FrameRect>,
    #[serde(default)]
    pub alternating_serve: bool,
    #[serde(default)]
    pub reset_actions: Vec<u32>,
    #[serde(default)]
    pub random_noops: bool,
    #[serde(default)]
    pub episodic_life: bool,
    #[serde(default)]
    pub emulator_mode: Option<u32>,
    #[serde(default = "max_cycles")]
    pub max_cycles: u32,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TrackingKind {
    Pong,
    Breakout,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum OutputKind {
    Action,
    Scores,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum PolicySpec {
    Tracking {
        game: TrackingKind,
    },
    Onnx {
        url: String,
        input_name: String,
        output_name: String,
        output: OutputKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        format: Option<CheckpointFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        sha256: Option<String>,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct InputSpec {
    pub width: u32,
    pub height: u32,
    pub history: u32,
    pub scale: f32,
    #[serde(default)]
    pub padding: FramePadding,
    #[serde(default)]
    pub grayscale_order: GrayscaleOrder,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FramePadding {
    #[default]
    Zero,
    Repeat,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum GrayscaleOrder {
    #[default]
    BeforeResize,
    AfterResize,
}
impl InputSpec {
    pub(crate) fn is_valid(&self) -> bool {
        (1..=256).contains(&self.width)
            && (1..=256).contains(&self.height)
            && (1..=16).contains(&self.history)
            && self.scale.is_finite()
            && self.scale > 0.0
    }
}
impl Default for InputSpec {
    fn default() -> Self {
        Self {
            width: 84,
            height: 84,
            history: 4,
            scale: 1.0,
            padding: FramePadding::Zero,
            grayscale_order: GrayscaleOrder::BeforeResize,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct ModelSpec {
    pub id: String,
    pub name: String,
    pub policy: PolicySpec,
    pub n_actions: u32,
    pub profile: Option<String>,
    #[serde(default)]
    pub input: InputSpec,
    #[serde(default)]
    pub uploaded: bool,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub default_model_ii: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct ControlMapping {
    pub direction: Direction,
    pub action: u32,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct GameSpec {
    pub key: String,
    pub label: String,
    pub description: String,
    pub rom_url: String,
    #[serde(default = "crate::config::atari_action_names")]
    pub action_names: Vec<String>,
    #[serde(default = "crate::config::joystick_controls")]
    pub controls: Vec<ControlMapping>,
    pub default_profile: String,
    pub profiles: Vec<Profile>,
    #[serde(deserialize_with = "crate::config::deserialize_modes")]
    pub modes: Vec<ModeSpec>,
    pub models: Vec<ModelSpec>,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct Manifest {
    pub version: u32,
    pub games: Vec<GameSpec>,
    pub ale_module: String,
    pub multi_ale_module: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub uploaded: bool,
    pub default: bool,
    pub default_model_ii: bool,
}
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ModeInfo {
    pub key: String,
    pub left_label: String,
    pub right_label: String,
    pub is_user: bool,
    pub user_controls: Option<UserControls>,
    pub players: Vec<PlayerSlot>,
    pub available: bool,
    pub error: Option<String>,
}
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GameInfo {
    pub key: String,
    pub label: String,
    pub description: String,
    pub modes: Vec<ModeInfo>,
    pub models: Vec<ModelInfo>,
}
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct Catalog {
    pub games: Vec<GameInfo>,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct PlayerSelection {
    pub slot: String,
    #[serde(rename = "type")]
    pub player_type: PlayerKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
}
fn auto() -> String {
    "auto".into()
}
fn mode() -> String {
    "game".into()
}
fn fps() -> u32 {
    20
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct StartRequest {
    pub game: String,
    #[serde(default = "mode")]
    pub mode: String,
    #[serde(default = "auto")]
    pub profile: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub players: Option<Vec<PlayerSelection>>,
    #[serde(default = "fps")]
    pub fps: u32,
    #[serde(default)]
    pub seed: u32,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum ClientMessage {
    Start(StartRequest),
    Input { direction: Direction },
    Reset,
    Stop,
}
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export)]
pub struct StartedPlayer {
    pub slot: String,
    #[serde(rename = "type")]
    pub player_type: PlayerKind,
    pub model: Option<String>,
    pub side: Side,
}
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct StartedMetadata {
    #[serde(rename = "type")]
    #[ts(type = "\"started\"")]
    pub message_type: &'static str,
    pub game: String,
    pub mode: String,
    pub profile: String,
    pub players: Vec<StartedPlayer>,
    pub starting_side: Option<Side>,
    pub match_number: u32,
}
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct FrameMetadata {
    #[serde(rename = "type")]
    #[ts(type = "\"frame\"")]
    pub message_type: &'static str,
    pub width: u32,
    pub height: u32,
    pub left_score: f64,
    pub right_score: f64,
    pub left_label: String,
    pub right_label: String,
    pub steps: u32,
    pub model_action: u32,
    pub model_action_name: String,
    pub player_actions: BTreeMap<String, u32>,
    pub player_action_names: BTreeMap<String, String>,
    pub starting_side: Option<Side>,
    pub match_number: u32,
}
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct FramePacket {
    pub metadata: FrameMetadata,
    #[serde(with = "serde_bytes")]
    #[ts(type = "Uint8Array")]
    pub pixels: Vec<u8>,
}
