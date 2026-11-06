use crate::{ColorSwap, Observation, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
pub trait ObservationView {
    fn validate_frame(&self, frame: &Observation) -> Result<()>;
    fn requires_ram(&self) -> bool {
        false
    }
    fn apply(&mut self, frame: &Observation, swaps: &[ColorSwap], rgb: &mut Vec<u8>);
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PolicyView {
    IceHockey,
}
impl PolicyView {
    pub(crate) fn build(self) -> Box<dyn ObservationView> {
        match self {
            Self::IceHockey => Box::<crate::ice_hockey::IceHockey>::default(),
        }
    }
    pub fn validate_frame(self, frame: &Observation) -> Result<()> {
        match self {
            Self::IceHockey => crate::ice_hockey::IceHockey::default().validate_frame(frame),
        }
    }
}
pub(crate) fn remap_color(pixel: &[u8], x: u32, y: u32, swaps: &[ColorSwap]) -> Option<[u8; 3]> {
    swaps.iter().find_map(|swap: &ColorSwap| {
        if swap
            .region
            .as_ref()
            .is_some_and(|region: &crate::FrameRect| !region.contains(x, y))
        {
            return None;
        }
        if pixel == swap.first {
            Some(swap.second)
        } else if pixel == swap.second {
            Some(swap.first)
        } else {
            None
        }
    })
}
