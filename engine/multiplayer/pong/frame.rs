use crate::tracking::{Histogram, pixel};
use crate::{Observation, TrackingPolicy};
const BRIGHT_PIXEL: u8 = 180;
const BACKGROUND_DISTANCE: f64 = 20.0;
pub(crate) struct Pong;
impl TrackingPolicy for Pong {
    fn actions(&self) -> [u32; 2] {
        [2, 3]
    }
    fn positions(&self, frame: &Observation, mirror: bool) -> [Option<f64>; 2] {
        let (mut ball, mut paddle): (Histogram, Histogram) =
            (Histogram::default(), Histogram::default());
        for y in 34..194 {
            for x in 20..140 {
                if pixel(frame, mirror, x, y)
                    .iter()
                    .all(|&val: &u8| val > BRIGHT_PIXEL)
                {
                    ball.push(y as u8);
                }
            }
        }
        let mut channels: [Histogram; 3] = std::array::from_fn(|_: usize| Histogram::default());
        for y in 34..194 {
            for x in 78..82 {
                for (channel, &val) in channels.iter_mut().zip(pixel(frame, mirror, x, y)) {
                    channel.push(val);
                }
            }
        }
        let background: [f64; 3] =
            channels.map(|channel: Histogram| channel.median().unwrap_or(0.0));
        for y in 34..194 {
            for x in 140..144 {
                if pixel(frame, mirror, x, y).iter().zip(background).any(
                    |(&val, background): (&u8, f64)| {
                        (f64::from(val) - background).abs() > BACKGROUND_DISTANCE
                    },
                ) {
                    paddle.push(y as u8);
                }
            }
        }
        [ball.median(), paddle.median()]
    }
}
