use crate::tracking::{Histogram, pixel};
use crate::{Observation, TrackingPolicy};
const RED_THRESHOLD: u8 = 140;
pub(crate) struct Breakout;
impl TrackingPolicy for Breakout {
    fn actions(&self) -> [u32; 2] {
        [3, 2]
    }
    fn positions(&self, frame: &Observation, mirror: bool) -> [Option<f64>; 2] {
        let (mut ball, mut paddle): (Histogram, Histogram) =
            (Histogram::default(), Histogram::default());
        for y in 98..188 {
            for x in 8..152 {
                if is_red(frame, mirror, x, y) {
                    ball.push(x as u8);
                }
            }
        }
        for y in 189..195 {
            for x in 6..154 {
                if is_red(frame, mirror, x, y) {
                    paddle.push(x as u8);
                }
            }
        }
        [ball.median(), paddle.median()]
    }
}

fn is_red(frame: &Observation, mirror: bool, x: usize, y: usize) -> bool {
    let color: &[u8] = pixel(frame, mirror, x, y);
    color[0] > RED_THRESHOLD && color[1] < RED_THRESHOLD && color[2] < RED_THRESHOLD
}
