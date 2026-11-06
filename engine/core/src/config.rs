use crate::frame::MAX_FRAME_DIMENSION;
use crate::types::DEFAULT_MAX_CYCLES;
use crate::{
    ArenaError, Catalog, ControlMapping, Direction, EmulatorKind, GameInfo, GameSpec, InputSpec,
    Manifest, ModeInfo, ModeSpec, ModelInfo, ModelSpec, OutputKind, PlayerKind, PlayerSlot,
    PolicySpec, Profile, Result, Scoring, Side, UserControls,
};
use serde::{Deserialize, Deserializer};
use std::collections::BTreeSet;

const ATARI_CONTROLS: [(Direction, &str); 18] = [
    (Direction::None, "NOOP"),
    (Direction::Fire, "FIRE"),
    (Direction::Up, "UP"),
    (Direction::Right, "RIGHT"),
    (Direction::Left, "LEFT"),
    (Direction::Down, "DOWN"),
    (Direction::UpRight, "UPRIGHT"),
    (Direction::UpLeft, "UPLEFT"),
    (Direction::DownRight, "DOWNRIGHT"),
    (Direction::DownLeft, "DOWNLEFT"),
    (Direction::UpFire, "UPFIRE"),
    (Direction::RightFire, "RIGHTFIRE"),
    (Direction::LeftFire, "LEFTFIRE"),
    (Direction::DownFire, "DOWNFIRE"),
    (Direction::UpRightFire, "UPRIGHTFIRE"),
    (Direction::UpLeftFire, "UPLEFTFIRE"),
    (Direction::DownRightFire, "DOWNRIGHTFIRE"),
    (Direction::DownLeftFire, "DOWNLEFTFIRE"),
];
pub(crate) fn atari_action_names() -> Vec<String> {
    ATARI_CONTROLS
        .iter()
        .map(|(_, name): &(Direction, &str)| (*name).into())
        .collect()
}
pub(crate) fn joystick_controls() -> Vec<ControlMapping> {
    ATARI_CONTROLS
        .iter()
        .enumerate()
        .map(
            |(idx, &(direction, _)): (usize, &(Direction, &str))| ControlMapping {
                direction,
                action: idx as u32,
            },
        )
        .collect()
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ModeSource {
    Inline(Vec<ModeSpec>),
    Template(Box<ModeTemplate>),
}
pub(crate) fn deserialize_modes<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Vec<ModeSpec>, D::Error> {
    Ok(match ModeSource::deserialize(deserializer)? {
        ModeSource::Inline(modes) => modes,
        ModeSource::Template(template) => template.modes().map_err(serde::de::Error::custom)?,
    })
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ModeTemplate {
    scoring: Scoring,
    user_controls: UserControls,
    opponent: PlayerSlot,
    emulator_mode: u32,
    #[serde(default)]
    reset_actions: Vec<u32>,
    single_reset_actions: Vec<u32>,
    human_reset_actions: Vec<u32>,
}
impl ModeTemplate {
    fn modes(self) -> Result<Vec<ModeSpec>> {
        if self.opponent.key != "second_0"
            || self.opponent.player_type != PlayerKind::Model
            || self.opponent.side != Side::Right
            || self.opponent.agent_index != 1
        {
            return Err(ArenaError::Configuration("Arena mode templates require a second_0 model on the right at agent index 1; use inline modes for custom slots".into()));
        }
        let first: PlayerSlot = PlayerSlot {
            key: "first_0".into(),
            player_type: PlayerKind::Model,
            side: Side::Left,
            mirror: false,
            policy_view: None,
            agent_index: 0,
            action_map: Vec::new(),
            color_swaps: Vec::new(),
        };
        Ok(vec![
            self.mode(
                "game",
                "MODEL",
                "GAME",
                vec![first.clone()],
                EmulatorKind::Ale,
                self.single_reset_actions.clone(),
            ),
            self.mode(
                "user",
                "MODEL",
                "YOU",
                vec![first.clone(), self.opponent.clone().into_human()],
                EmulatorKind::MultiAle,
                self.reset_actions.clone(),
            ),
            self.mode(
                "user-model",
                "YOU",
                "MODEL",
                vec![first.clone().into_human(), self.opponent.clone()],
                EmulatorKind::MultiAle,
                self.reset_actions.clone(),
            ),
            self.mode(
                "model",
                "MODEL",
                "MODEL",
                vec![first.clone(), self.opponent.clone()],
                EmulatorKind::MultiAle,
                self.reset_actions.clone(),
            ),
            self.mode(
                "user-game",
                "YOU",
                "GAME",
                vec![first.into_human()],
                EmulatorKind::Ale,
                self.human_reset_actions.clone(),
            ),
        ])
    }
    fn mode(
        &self,
        key: &str,
        left: &str,
        right: &str,
        players: Vec<PlayerSlot>,
        emulator: EmulatorKind,
        reset_actions: Vec<u32>,
    ) -> ModeSpec {
        ModeSpec {
            key: key.into(),
            left_label: left.into(),
            right_label: right.into(),
            user_controls: players
                .iter()
                .any(|player: &PlayerSlot| player.player_type == PlayerKind::Human)
                .then(|| self.user_controls.clone()),
            players,
            emulator,
            scoring: self.scoring.clone(),
            mirror_frame: false,
            display_unmirror_regions: Vec::new(),
            alternating_serve: false,
            reset_actions,
            random_noops: true,
            episodic_life: false,
            emulator_mode: (emulator == EmulatorKind::MultiAle).then_some(self.emulator_mode),
            max_cycles: DEFAULT_MAX_CYCLES,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod source {
    use super::*;
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ManifestSource {
        Inline(Manifest),
        Modules(ModuleManifest),
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct ModuleManifest {
        version: u32,
        games: Vec<String>,
        ale_module: String,
        multi_ale_module: String,
    }
    impl Manifest {
        pub fn load(path: impl AsRef<Path>) -> Result<Self> {
            let path: &Path = path.as_ref();
            let src: ManifestSource = read(path)?;
            let manifest: Manifest =
                match src {
                    ManifestSource::Inline(manifest) => manifest,
                    ManifestSource::Modules(src) => {
                        let parent: &Path = path.parent().ok_or_else(|| {
                            ArenaError::Configuration("Missing catalog directory".into())
                        })?;
                        let root: PathBuf =
                            parent
                                .join("..")
                                .canonicalize()
                                .map_err(|error: std::io::Error| {
                                    ArenaError::Configuration(error.to_string())
                                })?;
                        let mut games: Vec<GameSpec> = Vec::with_capacity(src.games.len());
                        for name in src.games {
                            let module: PathBuf = parent.join(name).canonicalize().map_err(
                                |error: std::io::Error| {
                                    ArenaError::Configuration(error.to_string())
                                },
                            )?;
                            let relative: &Path = module.strip_prefix(&root).map_err(
                                |_: std::path::StripPrefixError| {
                                    ArenaError::Configuration(
                                        "Game module must be inside engine".into(),
                                    )
                                },
                            )?;
                            let game: GameSpec = read(&module)?;
                            if game
                                .modes
                                .iter()
                                .any(|mode: &ModeSpec| mode.emulator == EmulatorKind::MultiAle)
                                && !relative.starts_with("multiplayer")
                            {
                                return Err(ArenaError::Configuration(format!(
                                    "Two-player game {} must be under multiplayer",
                                    game.key
                                )));
                            }
                            games.push(game);
                        }
                        Manifest {
                            version: src.version,
                            games,
                            ale_module: src.ale_module,
                            multi_ale_module: src.multi_ale_module,
                        }
                    }
                };
            manifest.validate()?;
            Ok(manifest)
        }
    }
    fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
        let bytes: Vec<u8> = fs::read(path).map_err(|error: std::io::Error| {
            ArenaError::Configuration(format!("{}: {error}", path.display()))
        })?;
        serde_json::from_slice(&bytes).map_err(|error: serde_json::Error| {
            ArenaError::Configuration(format!("{}: {error}", path.display()))
        })
    }
}

impl Manifest {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1 || self.games.is_empty() {
            return Err(ArenaError::Configuration(
                "Expected version 1 and at least one game".into(),
            ));
        }
        unique(
            self.games.iter().map(|game: &GameSpec| game.key.as_str()),
            "game",
        )?;
        for game in &self.games {
            game.validate()?;
        }
        Ok(())
    }
    pub fn game(&self, key: &str) -> Result<&GameSpec> {
        self.games
            .iter()
            .find(|game: &&GameSpec| game.key == key)
            .ok_or_else(|| ArenaError::Request(format!("Unknown game: {key}")))
    }
    pub fn catalog(&self) -> Catalog {
        Catalog {
            games: self
                .games
                .iter()
                .map(|game: &GameSpec| GameInfo {
                    key: game.key.clone(),
                    label: game.label.clone(),
                    description: game.description.clone(),
                    modes: game
                        .modes
                        .iter()
                        .map(|mode: &ModeSpec| ModeInfo {
                            key: mode.key.clone(),
                            left_label: mode.left_label.clone(),
                            right_label: mode.right_label.clone(),
                            players: mode.players.clone(),
                            is_user: mode
                                .players
                                .iter()
                                .any(|player: &PlayerSlot| player.player_type == PlayerKind::Human),
                            user_controls: mode.user_controls.clone(),
                            available: true,
                            error: None,
                        })
                        .collect(),
                    models: game
                        .models
                        .iter()
                        .map(|model: &ModelSpec| ModelInfo {
                            id: model.id.clone(),
                            name: model.name.clone(),
                            uploaded: model.uploaded,
                            default: model.default,
                            default_model_ii: model.default_model_ii,
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}
impl GameSpec {
    pub fn mode(&self, key: &str) -> Result<&ModeSpec> {
        self.modes
            .iter()
            .find(|mode: &&ModeSpec| mode.key == key)
            .ok_or_else(|| ArenaError::Request(format!("Unknown {} mode: {key}", self.key)))
    }
    pub fn profile(&self, key: &str) -> Result<&Profile> {
        self.profiles
            .iter()
            .find(|profile: &&Profile| profile.key == key)
            .ok_or_else(|| ArenaError::Request(format!("Unknown {} profile: {key}", self.key)))
    }
    pub fn model(&self, key: &str) -> Result<&ModelSpec> {
        self.models
            .iter()
            .find(|model: &&ModelSpec| model.id == key)
            .ok_or_else(|| ArenaError::Request(format!("Unknown {} model: {key}", self.key)))
    }
    pub fn default_model(&self) -> Result<&ModelSpec> {
        self.models
            .iter()
            .find(|model: &&ModelSpec| model.default)
            .or_else(|| self.models.first())
            .ok_or_else(|| ArenaError::Request(format!("{} has no models", self.key)))
    }
    pub fn action_name(&self, action: u32) -> String {
        self.action_names
            .get(action as usize)
            .cloned()
            .unwrap_or_else(|| action.to_string())
    }
    pub fn validate_action(&self, action: u32) -> Result<()> {
        if action as usize >= self.action_names.len() {
            Err(ArenaError::Request(format!(
                "Invalid {} action: {action}",
                self.key
            )))
        } else {
            Ok(())
        }
    }
    pub fn validate(&self) -> Result<()> {
        if self.key.trim().is_empty()
            || self.rom_url.is_empty()
            || self.action_names.is_empty()
            || self.modes.is_empty()
        {
            return Err(ArenaError::Configuration(format!(
                "Incomplete game: {}",
                self.key
            )));
        }
        unique(
            self.modes.iter().map(|mode: &ModeSpec| mode.key.as_str()),
            "mode",
        )?;
        unique(
            self.profiles
                .iter()
                .map(|profile: &Profile| profile.key.as_str()),
            "profile",
        )?;
        unique(
            self.models
                .iter()
                .map(|model: &ModelSpec| model.id.as_str()),
            "model",
        )?;
        self.profile(&self.default_profile)?;
        for profile in &self.profiles {
            if !profile.frame_skip.is_valid() || !(0.0..=1.0).contains(&profile.repeat_action_prob)
            {
                return Err(ArenaError::Configuration(format!(
                    "Invalid profile: {}",
                    profile.key
                )));
            }
        }
        for control in &self.controls {
            self.validate_action(control.action)?;
        }
        for mode in &self.modes {
            self.validate_mode(mode)?;
        }
        for model in &self.models {
            self.validate_model(model)?;
        }
        Ok(())
    }
    fn validate_mode(&self, mode: &ModeSpec) -> Result<()> {
        mode.scoring.validate()?;
        if mode.players.is_empty() || mode.players.len() > 4 || mode.max_cycles == 0 {
            return Err(ArenaError::Configuration(format!(
                "Invalid player count/cycle limit: {}",
                mode.key
            )));
        }
        unique(
            mode.players
                .iter()
                .map(|player: &PlayerSlot| player.key.as_str()),
            "player slot",
        )?;
        for player in &mode.players {
            self.validate_player(player)?;
        }
        let idxs: BTreeSet<usize> = mode
            .players
            .iter()
            .map(|player: &PlayerSlot| player.agent_index)
            .collect();
        if idxs != (0..mode.players.len()).collect::<BTreeSet<usize>>() {
            return Err(ArenaError::Configuration(
                "Agent indices must be unique and contiguous".into(),
            ));
        }
        if mode.emulator == EmulatorKind::Ale && mode.players.len() != 1 {
            return Err(ArenaError::Configuration(
                "ALE needs one controllable player".into(),
            ));
        }
        for &action in &mode.reset_actions {
            self.validate_action(action)?;
        }
        for region in &mode.display_unmirror_regions {
            region.validate(MAX_FRAME_DIMENSION, MAX_FRAME_DIMENSION)?;
        }
        Ok(())
    }
    fn validate_player(&self, player: &PlayerSlot) -> Result<()> {
        if !player.action_map.is_empty() && player.action_map.len() != self.action_names.len() {
            return Err(ArenaError::Configuration(
                "Action map must cover every action".into(),
            ));
        }
        for &action in &player.action_map {
            self.validate_action(action)?;
        }
        let mut colors: BTreeSet<[u8; 3]> = BTreeSet::new();
        for swap in &player.color_swaps {
            if let Some(region) = &swap.region {
                region.validate(MAX_FRAME_DIMENSION, MAX_FRAME_DIMENSION)?;
            }
            if !colors.insert(swap.first) || !colors.insert(swap.second) {
                return Err(ArenaError::Configuration(
                    "Color swaps must be unambiguous".into(),
                ));
            }
        }
        Ok(())
    }
    pub fn validate_model(&self, model: &ModelSpec) -> Result<()> {
        let input: &InputSpec = &model.input;
        if model.id.is_empty()
            || model.n_actions as usize != self.action_names.len()
            || !input.is_valid()
        {
            return Err(ArenaError::Configuration(format!(
                "Invalid model: {}",
                model.id
            )));
        }
        if let Some(profile) = &model.profile {
            self.profile(profile)?;
        }
        if let PolicySpec::Onnx {
            url,
            input_name,
            output_name,
            output,
            format,
            sha256,
        } = &model.policy
        {
            if url.is_empty() || input_name.is_empty() || output_name.is_empty() {
                return Err(ArenaError::Configuration("Incomplete ONNX policy".into()));
            }
            if sha256.as_ref().is_some_and(|hash: &String| {
                hash.len() != 64 || !hash.bytes().all(|val: u8| val.is_ascii_hexdigit())
            }) {
                return Err(ArenaError::Configuration("Invalid model SHA-256".into()));
            }
            if format.is_some()
                && (input.width != 84
                    || input.height != 84
                    || input.history != 4
                    || input.scale != 1.0
                    || input_name != "observation"
                    || output_name != "action"
                    || !matches!(output, OutputKind::Action))
            {
                return Err(ArenaError::Configuration(
                    "Atari checkpoints require raw [1, 4, 84, 84] observations and an action output"
                        .into(),
                ));
            }
        }
        Ok(())
    }
}
fn unique<'a>(vals: impl Iterator<Item = &'a str>, label: &str) -> Result<()> {
    let mut seen: BTreeSet<&'a str> = BTreeSet::new();
    for val in vals {
        if val.trim().is_empty() || !seen.insert(val) {
            return Err(ArenaError::Configuration(format!(
                "Empty/duplicate {label}: {val}"
            )));
        }
    }
    Ok(())
}
