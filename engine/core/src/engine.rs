use crate::{
    ArenaError, ControlMapping, Direction, EmulatorKind, FrameMetadata, FramePacket, FrameStack,
    GameSpec, InputSpec, Manifest, ModeSpec, ModelSpec, Observation, PlayerSelection, PlayerSlot,
    PolicySpec, Profile, Result, Side, StartRequest, StartedMetadata, StartedPlayer,
    resolve_players, tracking_action,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

const NOOP_ACTION: u32 = 0;
const RESET_NOOP_LIMIT: u32 = 30;

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct EnvironmentConfig {
    pub game: String,
    pub rom_url: String,
    pub emulator: EmulatorKind,
    pub emulator_mode: Option<u32>,
    pub n_actions: u32,
    pub player_count: usize,
    pub repeat_action_prob: f32,
    pub seed: u32,
    #[serde(default)]
    pub capture_ram: bool,
}
#[derive(Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct Transition {
    pub observation: Observation,
    pub rewards: Vec<f64>,
    pub done: bool,
}
pub trait Host {
    fn configure(&mut self, cfg: &EnvironmentConfig) -> impl Future<Output = Result<()>>;
    fn reset(&mut self, side: Option<Side>) -> impl Future<Output = Result<Observation>>;
    fn act(&mut self, actions: &[u32]) -> impl Future<Output = Result<Transition>>;
    fn predict(
        &mut self,
        model: &ModelSpec,
        vals: &[f32],
        dims: [u32; 4],
    ) -> impl Future<Output = Result<u32>>;
}

struct PlayerRuntime {
    slot: PlayerSlot,
    model: Option<ModelSpec>,
    stack: FrameStack,
    serve: Option<usize>,
    vals: Vec<f32>,
}
impl PlayerRuntime {
    fn new(slot: PlayerSlot, model: Option<ModelSpec>) -> Self {
        let input: InputSpec = model
            .as_ref()
            .map(|model: &ModelSpec| model.input.clone())
            .unwrap_or_default();
        let stack: FrameStack =
            FrameStack::with_colors(input, slot.mirror, slot.color_swaps.clone())
                .with_policy_view(slot.policy_view);
        Self {
            slot,
            model,
            stack,
            serve: None,
            vals: Vec::new(),
        }
    }
    async fn action<H: Host>(
        &mut self,
        host: &mut H,
        game: &GameSpec,
        frame: &Observation,
        human_action: u32,
        reset_actions: &[u32],
    ) -> Result<u32> {
        let action: u32 = if let Some(model) = &self.model {
            if let Some(action) = self
                .serve
                .and_then(|idx: usize| reset_actions.get(idx))
                .copied()
            {
                self.serve = self.serve.map(|idx: usize| idx + 1);
                action
            } else {
                self.serve = None;
                match model.policy {
                    PolicySpec::Tracking { game } => {
                        tracking_action(game, frame, self.slot.mirror)?
                    }
                    PolicySpec::Onnx { .. } => {
                        self.stack.push_into(frame, &mut self.vals)?;
                        host.predict(model, &self.vals, self.stack.dimensions())
                            .await?
                    }
                }
            }
        } else {
            human_action
        };
        game.validate_action(action)?;
        Ok(
            if self.model.is_some() && !self.slot.action_map.is_empty() {
                self.slot.action_map[action as usize]
            } else {
                action
            },
        )
    }
    fn started(&self) -> StartedPlayer {
        StartedPlayer {
            slot: self.slot.key.clone(),
            player_type: self.slot.player_type,
            model: self
                .model
                .as_ref()
                .map(|model: &ModelSpec| model.id.clone()),
            side: self.slot.side,
        }
    }
}

struct ActionSelection {
    actions: Vec<u32>,
    by_slot: BTreeMap<String, u32>,
    model_action: u32,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum ResetPhase {
    Start,
    LifeLoss,
}

struct RepeatedFrames {
    rewards: Vec<f64>,
    prev: Option<Observation>,
    latest: Option<Transition>,
}
impl RepeatedFrames {
    fn new(players: usize) -> Self {
        Self {
            rewards: vec![0.0; players],
            prev: None,
            latest: None,
        }
    }
    fn push(&mut self, transition: Transition) -> Result<bool> {
        transition.observation.validate()?;
        if transition.rewards.len() != self.rewards.len()
            || transition
                .rewards
                .iter()
                .any(|reward: &f64| !reward.is_finite())
        {
            return Err(ArenaError::Emulator("Invalid reward vector".into()));
        }
        if let Some(prev) = &self.latest
            && (prev.observation.width != transition.observation.width
                || prev.observation.height != transition.observation.height)
        {
            return Err(ArenaError::Emulator(
                "Frame dimensions changed during action repeat".into(),
            ));
        }
        for (sum, reward) in self.rewards.iter_mut().zip(&transition.rewards) {
            *sum += reward;
        }
        self.prev = self.latest.take().map(|prev: Transition| prev.observation);
        let done: bool = transition.done;
        self.latest = Some(transition);
        Ok(done)
    }
    fn finish(self) -> Result<Transition> {
        let mut transition: Transition = self
            .latest
            .ok_or_else(|| ArenaError::Configuration("Zero frame skip".into()))?;
        transition.rewards = self.rewards;
        if let Some(prev) = self.prev {
            for (val, prior) in transition.observation.rgb.iter_mut().zip(prev.rgb) {
                *val = (*val).max(prior);
            }
        }
        Ok(transition)
    }
}

pub struct Engine<H: Host> {
    host: H,
    game: GameSpec,
    mode: ModeSpec,
    profile: Profile,
    players: Vec<PlayerRuntime>,
    observation: Option<Observation>,
    direction: Direction,
    scores: [f64; 2],
    steps: u32,
    match_number: u32,
    starting_side: Option<Side>,
    needs_reset: bool,
    rng: u32,
}
impl<H: Host> Engine<H> {
    pub fn new(host: H, manifest: &Manifest, req: &StartRequest) -> Result<Self> {
        manifest.validate()?;
        let game: GameSpec = manifest.game(&req.game)?.clone();
        let mode: ModeSpec = game.mode(&req.mode)?.clone();
        let selected: Vec<PlayerSelection> =
            resolve_players(&game, &mode, req.players.as_deref(), req.model.as_deref())?;
        let first: Option<&ModelSpec> = selected
            .iter()
            .find_map(|player: &PlayerSelection| player.model.as_ref())
            .map(|id: &String| game.model(id))
            .transpose()?;
        let profile_key: &str = if req.profile == "auto" {
            first
                .and_then(|model: &ModelSpec| model.profile.as_deref())
                .unwrap_or(&game.default_profile)
        } else {
            &req.profile
        };
        let profile: Profile = game.profile(profile_key)?.clone();
        let mut players: Vec<PlayerRuntime> = Vec::with_capacity(selected.len());
        for (slot, selection) in mode.players.iter().zip(selected) {
            let model: Option<ModelSpec> = selection
                .model
                .as_ref()
                .map(|id: &String| game.model(id).cloned())
                .transpose()?;
            players.push(PlayerRuntime::new(slot.clone(), model));
        }
        Ok(Self {
            host,
            game,
            mode,
            profile,
            players,
            observation: None,
            direction: Direction::None,
            scores: [0.0; 2],
            steps: 0,
            match_number: 0,
            starting_side: None,
            needs_reset: false,
            rng: req.seed.max(1),
        })
    }
    pub async fn start(&mut self, seed: u32) -> Result<StartedMetadata> {
        let cfg: EnvironmentConfig = EnvironmentConfig {
            game: self.game.key.clone(),
            rom_url: self.game.rom_url.clone(),
            emulator: self.mode.emulator,
            emulator_mode: self.mode.emulator_mode,
            n_actions: self.game.action_names.len() as u32,
            player_count: self.players.len(),
            repeat_action_prob: self.profile.repeat_action_prob,
            seed,
            capture_ram: self.mode.scoring.requires_ram()
                || self
                    .players
                    .iter()
                    .any(|player: &PlayerRuntime| player.stack.requires_ram()),
        };
        self.host.configure(&cfg).await?;
        self.reset().await?;
        Ok(self.started())
    }
    pub fn started(&self) -> StartedMetadata {
        StartedMetadata {
            message_type: "started",
            game: self.game.key.clone(),
            mode: self.mode.key.clone(),
            profile: self.profile.key.clone(),
            players: self.players.iter().map(PlayerRuntime::started).collect(),
            starting_side: self.starting_side,
            match_number: self.match_number,
        }
    }
    pub fn input(&mut self, direction: Direction) {
        self.direction = direction;
    }
    pub async fn reset(&mut self) -> Result<()> {
        if self.mode.alternating_serve {
            self.starting_side = Some(match self.starting_side {
                Some(side) => side.opposite(),
                None => {
                    if self.random(2) == 0 {
                        Side::Left
                    } else {
                        Side::Right
                    }
                }
            });
        }
        let frame: Observation = self.host.reset(self.starting_side).await?;
        self.store(frame)?;
        self.scores = [0.0; 2];
        self.steps = 0;
        self.direction = Direction::None;
        self.match_number = self.match_number.saturating_add(1);
        self.needs_reset = false;
        for player in &mut self.players {
            player.stack.reset();
            player.serve = None;
        }
        if self.mode.random_noops {
            let count: u32 = self.random(RESET_NOOP_LIMIT) + 1;
            let actions: Vec<u32> = vec![NOOP_ACTION; self.players.len()];
            for _ in 0..count {
                let transition: Transition = self.host.act(&actions).await?;
                let frame: Observation = if transition.done {
                    self.host.reset(self.starting_side).await?
                } else {
                    transition.observation
                };
                self.store(frame)?;
            }
        }
        if self.mode.emulator == EmulatorKind::Ale {
            self.play_reset_actions(ResetPhase::Start).await?;
        } else {
            self.queue_serves();
        }
        Ok(())
    }
    async fn select_actions(&mut self) -> Result<ActionSelection> {
        let frame: &Observation = self
            .observation
            .as_ref()
            .ok_or_else(|| ArenaError::Request("Session has not started".into()))?;
        let human_action: u32 = self
            .game
            .controls
            .iter()
            .find(|control: &&ControlMapping| control.direction == self.direction)
            .map(|control: &ControlMapping| control.action)
            .unwrap_or(NOOP_ACTION);
        let mut selection: ActionSelection = ActionSelection {
            actions: vec![NOOP_ACTION; self.players.len()],
            by_slot: BTreeMap::new(),
            model_action: NOOP_ACTION,
        };
        for player in &mut self.players {
            let action: u32 = player
                .action(
                    &mut self.host,
                    &self.game,
                    frame,
                    human_action,
                    &self.mode.reset_actions,
                )
                .await?;
            selection.actions[player.slot.agent_index] = action;
            selection.by_slot.insert(player.slot.key.clone(), action);
            if player.model.is_some() {
                selection.model_action = action;
            }
        }
        Ok(selection)
    }
    pub async fn step(&mut self) -> Result<FramePacket> {
        if self.needs_reset {
            self.reset().await?;
        }
        let selection: ActionSelection = self.select_actions().await?;
        let lives: Option<u32> = self
            .observation
            .as_ref()
            .and_then(|frame: &Observation| frame.lives);
        let transition: Transition = self.repeat(&selection.actions).await?;
        self.mode.scoring.update(
            &mut self.scores,
            &transition.rewards,
            self.players
                .iter()
                .map(|player: &PlayerRuntime| &player.slot),
            &transition.observation.ram,
        )?;
        let scored: bool = transition.rewards.iter().any(|&reward: &f64| reward != 0.0);
        let life_lost: bool = self.mode.episodic_life
            && !transition.done
            && match (lives, transition.observation.lives) {
                (Some(prev), Some(cur)) => cur > 0 && cur < prev,
                _ => false,
            };
        self.store(transition.observation)?;
        if life_lost {
            self.play_reset_actions(ResetPhase::LifeLoss).await?;
            for player in &mut self.players {
                player.stack.reset();
            }
        }
        if scored && self.mode.emulator == EmulatorKind::MultiAle {
            self.queue_serves();
        }
        self.steps = self.steps.saturating_add(1);
        self.needs_reset |= transition.done || self.steps >= self.mode.max_cycles;
        self.packet(selection)
    }
    fn packet(&self, selection: ActionSelection) -> Result<FramePacket> {
        let frame: &Observation = self
            .observation
            .as_ref()
            .ok_or_else(|| ArenaError::Emulator("No frame".into()))?;
        Ok(FramePacket {
            metadata: FrameMetadata {
                message_type: "frame",
                width: frame.width,
                height: frame.height,
                left_score: self.scores[0],
                right_score: self.scores[1],
                left_label: self.mode.left_label.clone(),
                right_label: self.mode.right_label.clone(),
                steps: self.steps,
                model_action: selection.model_action,
                model_action_name: self.game.action_name(selection.model_action),
                player_action_names: selection
                    .by_slot
                    .iter()
                    .map(|(slot, &action): (&String, &u32)| {
                        (slot.clone(), self.game.action_name(action))
                    })
                    .collect(),
                player_actions: selection.by_slot,
                starting_side: self.starting_side,
                match_number: self.match_number,
                is_finished: self.needs_reset,
            },
            pixels: frame.display_rgba(&self.mode.display_unmirror_regions)?,
        })
    }
    async fn play_reset_actions(&mut self, phase: ResetPhase) -> Result<()> {
        let noop_count: usize = usize::from(phase == ResetPhase::LifeLoss);
        for idx in 0..self.mode.reset_actions.len() + noop_count {
            let action: u32 = if idx < noop_count {
                NOOP_ACTION
            } else {
                self.mode.reset_actions[idx - noop_count]
            };
            let transition: Transition = self.repeat(&[action]).await?;
            self.store(transition.observation)?;
            if transition.done {
                self.needs_reset = true;
                break;
            }
        }
        Ok(())
    }
    async fn repeat(&mut self, actions: &[u32]) -> Result<Transition> {
        let (min, max): (u32, u32) = self.profile.frame_skip.bounds();
        let count: u32 = min + self.random(max - min);
        let mut frames: RepeatedFrames = RepeatedFrames::new(self.players.len());
        for _ in 0..count {
            let transition: Transition = self.host.act(actions).await?;
            if frames.push(transition)? {
                break;
            }
        }
        frames.finish()
    }
    fn store(&mut self, mut frame: Observation) -> Result<()> {
        frame.validate()?;
        for player in &self.players {
            player.stack.validate_frame(&frame)?;
        }
        if self.mode.mirror_frame {
            frame.mirror();
        }
        self.observation = Some(frame);
        Ok(())
    }
    fn queue_serves(&mut self) {
        for player in &mut self.players {
            if player.model.is_some() {
                player.serve = Some(0);
            }
        }
    }
    fn random(&mut self, upper: u32) -> u32 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 17;
        self.rng ^= self.rng << 5;
        self.rng % upper.max(1)
    }
}
