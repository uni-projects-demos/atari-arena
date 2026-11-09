use crate::frame::{ATARI_HEIGHT, ATARI_WIDTH, RGB_CHANNELS};
use crate::{ArenaError, Observation, Result, TrackingKind};
const TRACKING_MARGIN: f64 = 3.0;
const HISTOGRAM_BINS: usize = 256;
pub trait TrackingPolicy {
    fn positions(&self, frame: &Observation, mirror: bool) -> [Option<f64>; 2];
    fn actions(&self) -> [u32; 2];
    fn tracking_action(&self, frame: &Observation, mirror: bool) -> Result<u32> {
        frame.validate()?;
        if frame.width != ATARI_WIDTH || frame.height != ATARI_HEIGHT {
            return Err(ArenaError::Inference(
                "Tracking requires a 160×210 Atari frame".into(),
            ));
        }
        let [ball, paddle]: [Option<f64>; 2] = self.positions(frame, mirror);
        let Some(ball): Option<f64> = ball else {
            return Ok(1);
        };
        let Some(paddle): Option<f64> = paddle else {
            return Ok(0);
        };
        let [lower, higher]: [u32; 2] = self.actions();
        Ok(if ball < paddle - TRACKING_MARGIN {
            lower
        } else if ball > paddle + TRACKING_MARGIN {
            higher
        } else {
            0
        })
    }
}
pub fn tracking_action(_type: TrackingKind, frame: &Observation, mirror: bool) -> Result<u32> {
    match _type {
        TrackingKind::Pong => crate::pong::Pong.tracking_action(frame, mirror),
        TrackingKind::Breakout => crate::breakout::Breakout.tracking_action(frame, mirror),
    }
}
pub(crate) fn pixel(frame: &Observation, mirror: bool, x: usize, y: usize) -> &[u8] {
    let x: usize = if mirror {
        ATARI_WIDTH as usize - x - 1
    } else {
        x
    };
    let idx: usize = (y * ATARI_WIDTH as usize + x) * RGB_CHANNELS;
    &frame.rgb[idx..idx + RGB_CHANNELS]
}
pub(crate) struct Histogram {
    counts: [u32; HISTOGRAM_BINS],
    len: u32,
}
impl Default for Histogram {
    fn default() -> Self {
        Self {
            counts: [0; HISTOGRAM_BINS],
            len: 0,
        }
    }
}
impl Histogram {
    pub fn push(&mut self, val: u8) {
        self.counts[usize::from(val)] += 1;
        self.len += 1;
    }
    pub fn median(&self) -> Option<f64> {
        if self.len == 0 {
            return None;
        }
        let lower: u32 = (self.len - 1) / 2;
        let higher: u32 = self.len / 2;
        let mut count: u32 = 0;
        let mut first: Option<f64> = None;
        for (val, frequency) in self.counts.iter().enumerate() {
            count += frequency;
            if count > lower && first.is_none() {
                first = Some(val as f64);
            }
            if count > higher {
                return first.map(|first: f64| (first + val as f64) / 2.0);
            }
        }
        None
    }
}
