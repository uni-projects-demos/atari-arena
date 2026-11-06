use crate::frame::RAM_BYTES;
use crate::{ArenaError, PlayerSlot, Result, Side};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CounterEncoding {
    Binary,
    Bcd,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct CounterOverride {
    pub value: u8,
    pub score: u32,
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum Scoring {
    Signed {
        positive: Side,
        negative: Side,
    },
    Players,
    Ram {
        addresses: [u8; 2],
        encoding: CounterEncoding,
        #[serde(default)]
        overrides: Vec<CounterOverride>,
    },
}
impl Scoring {
    pub fn requires_ram(&self) -> bool {
        matches!(self, Self::Ram { .. })
    }
    pub(crate) fn update<'a>(
        &self,
        scores: &mut [f64; 2],
        rewards: &[f64],
        players: impl Iterator<Item = &'a PlayerSlot>,
        ram: &[u8],
    ) -> Result<()> {
        match self {
            Self::Signed { positive, negative } => {
                let reward: f64 = rewards
                    .first()
                    .copied()
                    .ok_or_else(|| ArenaError::Emulator("Missing score reward".into()))?;
                if reward > 0.0 {
                    scores[index(*positive)] += reward;
                } else {
                    scores[index(*negative)] -= reward;
                }
            }
            Self::Players => {
                for slot in players {
                    let reward: &f64 = rewards
                        .get(slot.agent_index)
                        .ok_or_else(|| ArenaError::Emulator("Missing player reward".into()))?;
                    scores[index(slot.side)] += reward.max(0.0);
                }
            }
            Self::Ram { .. } => *scores = self.read_ram(ram)?,
        }
        Ok(())
    }
    pub fn validate(&self) -> Result<()> {
        if let Self::Ram {
            addresses,
            overrides,
            ..
        } = self
        {
            let vals: BTreeSet<u8> = overrides
                .iter()
                .map(|val: &CounterOverride| val.value)
                .collect();
            if addresses
                .iter()
                .any(|&address: &u8| usize::from(address) >= RAM_BYTES)
                || addresses[0] == addresses[1]
                || vals.len() != overrides.len()
            {
                return Err(ArenaError::Configuration(
                    "Invalid RAM score counters".into(),
                ));
            }
        }
        Ok(())
    }
    pub fn read_ram(&self, ram: &[u8]) -> Result<[f64; 2]> {
        let Self::Ram {
            addresses,
            encoding,
            overrides,
        }: &Self = self
        else {
            return Err(ArenaError::Configuration("Expected RAM scoring".into()));
        };
        let mut scores: [f64; 2] = [0.0; 2];
        for (score, &address) in scores.iter_mut().zip(addresses) {
            let &val: &u8 = ram
                .get(usize::from(address))
                .ok_or_else(|| ArenaError::Emulator("Missing score RAM".into()))?;
            let decoded: u32 = if let Some(special) = overrides
                .iter()
                .find(|counter: &&CounterOverride| counter.value == val)
            {
                special.score
            } else {
                match encoding {
                    CounterEncoding::Binary => u32::from(val),
                    CounterEncoding::Bcd if val >> 4 <= 9 && val & 15 <= 9 => {
                        u32::from(val >> 4) * 10 + u32::from(val & 15)
                    }
                    CounterEncoding::Bcd => {
                        return Err(ArenaError::Emulator("Invalid BCD score".into()));
                    }
                }
            };
            *score = f64::from(decoded);
        }
        Ok(scores)
    }
}

fn index(side: Side) -> usize {
    match side {
        Side::Left => 0,
        Side::Right => 1,
    }
}
