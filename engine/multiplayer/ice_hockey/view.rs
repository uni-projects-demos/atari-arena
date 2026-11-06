use crate::frame::{ATARI_HEIGHT, ATARI_WIDTH, RAM_BYTES, RGB_CHANNELS};
use crate::view::remap_color;
use crate::{ArenaError, ColorSwap, Observation, ObservationView, Result};
#[derive(Default)]
pub(crate) struct IceHockey {
    moved: Vec<(usize, [u8; 3])>,
}
impl ObservationView for IceHockey {
    fn validate_frame(&self, frame: &Observation) -> Result<()> {
        if frame.width != ATARI_WIDTH
            || frame.height != ATARI_HEIGHT
            || frame.ram.len() != RAM_BYTES
        {
            return Err(ArenaError::Emulator(
                "Hockey player views require 160×210 RGB and 128 RAM bytes".into(),
            ));
        }
        Ok(())
    }
    fn requires_ram(&self) -> bool {
        true
    }
    fn apply(&mut self, frame: &Observation, swaps: &[ColorSwap], rgb: &mut Vec<u8>) {
        hockey_opponent(frame, swaps, rgb, &mut self.moved);
    }
}
struct Skater {
    x: i32,
    top: i32,
    team: usize,
}

fn hockey_opponent(
    frame: &Observation,
    swaps: &[ColorSwap],
    rgb: &mut Vec<u8>,
    moved: &mut Vec<(usize, [u8; 3])>,
) {
    const RINK_Y_SUM: i32 = 230;
    const SKATER_HEIGHT: i32 = 20;
    let pos: [(usize, usize); 4] = [(57, 53), (59, 55), (58, 54), (60, 56)];
    let skaters: [Skater; 4] = std::array::from_fn(|idx: usize| {
        let (x_addr, y_addr): (usize, usize) = pos[idx];
        Skater {
            x: i32::from(frame.ram[x_addr]) - 5,
            top: 168 - i32::from(frame.ram[y_addr]),
            team: if idx < 2 { 0 } else { 1 },
        }
    });
    rgb.clear();
    rgb.extend_from_slice(&frame.rgb);
    moved.clear();
    for y in 30..188_i32 {
        for x in 16..144_i32 {
            let idx: usize = pixel_offset(x, y);
            let color: [u8; 3] = [frame.rgb[idx], frame.rgb[idx + 1], frame.rgb[idx + 2]];
            let team: Option<usize> = match color {
                [45, 50, 184] | [184, 50, 50] | [84, 92, 214] => Some(0),
                [82, 126, 45] | [232, 204, 99] | [210, 182, 86] => Some(1),
                [200, 72, 72] => None,
                _ => continue,
            };
            let skater: Option<&Skater> = skaters
                .iter()
                .filter(|skater: &&Skater| team.is_none_or(|team: usize| skater.team == team))
                .min_by_key(|skater: &&Skater| {
                    (x - skater.x).pow(2) + (y - skater.top - 10).pow(2)
                });
            let Some(skater): Option<&Skater> = skater else {
                continue;
            };
            restore_background(rgb, x, y);
            // Reflect the skates' anchor, then retain the upright sprite offsets.
            let target_y: i32 = y + RINK_Y_SUM - 2 * SKATER_HEIGHT - 2 * skater.top;
            if (0..ATARI_HEIGHT as i32).contains(&target_y) {
                let val: [u8; 3] = remap_color(&color, x as u32, y as u32, swaps).unwrap_or(color);
                moved.push((pixel_offset(x, target_y), val));
            }
        }
    }
    let puck_x: i32 = i32::from(frame.ram[52]) - 9;
    let puck_y: i32 = 188 - i32::from(frame.ram[91]);
    for y in puck_y..puck_y + 2 {
        for x in puck_x..puck_x + 2 {
            if !(32..128).contains(&x) || !(42..188).contains(&y) {
                continue;
            }
            let idx: usize = pixel_offset(x, y);
            if frame.rgb[idx..idx + RGB_CHANNELS] != [0; 3] {
                continue;
            }
            restore_background(rgb, x, y);
            let target_y: i32 = y + RINK_Y_SUM - 2 - 2 * puck_y;
            if (0..ATARI_HEIGHT as i32).contains(&target_y) {
                moved.push((pixel_offset(x, target_y), [0; 3]));
            }
        }
    }
    for &(idx, color) in moved.iter() {
        rgb[idx..idx + RGB_CHANNELS].copy_from_slice(&color);
    }
}

fn pixel_offset(x: i32, y: i32) -> usize {
    ((y * ATARI_WIDTH as i32 + x) * RGB_CHANNELS as i32) as usize
}
fn restore_background(rgb: &mut [u8], x: i32, y: i32) {
    let idx: usize = pixel_offset(x, y);
    let val: u8 = if (32..128).contains(&x) && (42..188).contains(&y) {
        192
    } else {
        0
    };
    rgb[idx..idx + RGB_CHANNELS].fill(val);
}
