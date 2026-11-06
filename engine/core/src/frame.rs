use crate::{
    ArenaError, ColorSwap, FramePadding, FrameRect, GrayscaleOrder, InputSpec, PolicyView, Result,
};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use ts_rs::TS;

pub(crate) const ATARI_WIDTH: u32 = 160;
pub(crate) const ATARI_HEIGHT: u32 = 210;
pub(crate) const MAX_FRAME_DIMENSION: u32 = 1024;
pub(crate) const RAM_BYTES: usize = 128;
pub(crate) const RGB_CHANNELS: usize = 3;
const RGBA_CHANNELS: usize = 4;
const OPAQUE_ALPHA: u8 = 255;
type AxisWeights = Vec<Vec<(usize, f32)>>;

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct Observation {
    pub width: u32,
    pub height: u32,
    #[serde(with = "serde_bytes")]
    #[ts(type = "Uint8Array")]
    pub rgb: Vec<u8>,
    pub lives: Option<u32>,
    #[serde(default, with = "serde_bytes")]
    #[ts(type = "Uint8Array")]
    pub ram: Vec<u8>,
}
impl Observation {
    pub fn validate(&self) -> Result<()> {
        if self.width == 0
            || self.height == 0
            || self.width > MAX_FRAME_DIMENSION
            || self.height > MAX_FRAME_DIMENSION
            || self.rgb.len() != self.width as usize * self.height as usize * RGB_CHANNELS
            || (!self.ram.is_empty() && self.ram.len() != RAM_BYTES)
        {
            return Err(ArenaError::Emulator(
                "Expected a bounded H×W×3 RGB frame".into(),
            ));
        }
        Ok(())
    }
    pub fn mirror(&mut self) {
        let width: usize = self.width as usize;
        for row in self.rgb.chunks_exact_mut(width * RGB_CHANNELS) {
            mirror_row::<RGB_CHANNELS>(row);
        }
    }
    pub fn rgba(&self) -> Vec<u8> {
        let mut dest: Vec<u8> =
            Vec::with_capacity(self.width as usize * self.height as usize * RGBA_CHANNELS);
        for pixel in self.rgb.chunks_exact(RGB_CHANNELS) {
            dest.extend_from_slice(pixel);
            dest.push(OPAQUE_ALPHA);
        }
        dest
    }
    /// Presentation changes apply only to the RGBA copy sent to the UI.
    pub fn display_rgba(&self, unmirror_regions: &[FrameRect]) -> Result<Vec<u8>> {
        let mut dest: Vec<u8> = self.rgba();
        for region in unmirror_regions {
            region.validate(self.width, self.height)?;
            for y in region.top..region.top + region.height {
                let start: usize =
                    (y as usize * self.width as usize + region.left as usize) * RGBA_CHANNELS;
                let end: usize = start + region.width as usize * RGBA_CHANNELS;
                mirror_row::<RGBA_CHANNELS>(&mut dest[start..end]);
            }
        }
        Ok(dest)
    }
}
fn mirror_row<const CHANNELS: usize>(row: &mut [u8]) {
    let width: usize = row.len() / CHANNELS;
    for x in 0..width / 2 {
        for c in 0..CHANNELS {
            row.swap(x * CHANNELS + c, (width - x - 1) * CHANNELS + c);
        }
    }
}
pub struct FrameStack {
    cfg: InputSpec,
    mirror: bool,
    color_swaps: Vec<ColorSwap>,
    preprocessor: Preprocessor,
    frames: VecDeque<Vec<u8>>,
}
impl FrameStack {
    pub fn new(spec: InputSpec, mirror: bool) -> Self {
        Self::with_colors(spec, mirror, Vec::new())
    }
    pub fn with_colors(spec: InputSpec, mirror: bool, color_swaps: Vec<ColorSwap>) -> Self {
        Self {
            cfg: spec,
            mirror,
            color_swaps,
            preprocessor: Preprocessor::default(),
            frames: VecDeque::new(),
        }
    }
    pub(crate) fn with_policy_view(mut self, view: Option<PolicyView>) -> Self {
        self.preprocessor.view = view.map(PolicyView::build);
        self
    }
    pub fn reset(&mut self) {
        self.frames.clear();
    }
    pub fn dimensions(&self) -> [u32; 4] {
        [1, self.cfg.history, self.cfg.height, self.cfg.width]
    }
    pub(crate) fn requires_ram(&self) -> bool {
        self.preprocessor
            .view
            .as_deref()
            .is_some_and(|view: &dyn crate::ObservationView| view.requires_ram())
    }
    pub(crate) fn validate_frame(&self, frame: &Observation) -> Result<()> {
        if let Some(view) = &self.preprocessor.view {
            view.validate_frame(frame)?;
        }
        for swap in &self.color_swaps {
            if let Some(region) = swap.region {
                region.validate(frame.width, frame.height)?;
            }
        }
        Ok(())
    }
    pub fn push(&mut self, frame: &Observation) -> Vec<f32> {
        let mut vals: Vec<f32> = Vec::new();
        self.push_into(frame, &mut vals)
            .expect("FrameStack requires a valid frame and input specification");
        vals
    }
    pub fn push_into(&mut self, frame: &Observation, vals: &mut Vec<f32>) -> Result<()> {
        frame.validate()?;
        if !self.cfg.is_valid() {
            return Err(ArenaError::Configuration(
                "Invalid model input specification".into(),
            ));
        }
        self.validate_frame(frame)?;
        let mut gray: Vec<u8> = if self.frames.len() == self.cfg.history as usize {
            self.frames.pop_front().unwrap_or_default()
        } else {
            Vec::new()
        };
        self.preprocessor
            .preprocess(frame, &self.cfg, self.mirror, &self.color_swaps, &mut gray);
        if self.frames.is_empty() {
            for _ in 1..self.cfg.history {
                self.frames.push_back(match self.cfg.padding {
                    FramePadding::Zero => vec![0; gray.len()],
                    FramePadding::Repeat => gray.clone(),
                });
            }
        }
        self.frames.push_back(gray);
        vals.clear();
        vals.reserve(
            self.cfg.width as usize * self.cfg.height as usize * self.cfg.history as usize,
        );
        vals.extend(
            self.frames
                .iter()
                .flatten()
                .map(|&val: &u8| f32::from(val) * self.cfg.scale),
        );
        Ok(())
    }
}

#[derive(Default)]
struct Preprocessor {
    view: Option<Box<dyn crate::ObservationView>>,
    rgb: Vec<u8>,
    gray: Vec<u8>,
    rows: Vec<f32>,
    resized: Vec<u8>,
    plan: Option<ResizePlan>,
}
impl Preprocessor {
    fn preprocess(
        &mut self,
        frame: &Observation,
        spec: &InputSpec,
        mirror: bool,
        swaps: &[ColorSwap],
        out: &mut Vec<u8>,
    ) {
        let shape: [usize; 4] = [
            frame.width as usize,
            frame.height as usize,
            spec.width as usize,
            spec.height as usize,
        ];
        if self
            .plan
            .as_ref()
            .is_none_or(|plan: &ResizePlan| plan.shape != shape || plan.mirror != mirror)
        {
            self.plan = Some(ResizePlan::new(shape, mirror));
        }
        let pixels: &[u8] = if let Some(view) = &mut self.view {
            view.apply(frame, swaps, &mut self.rgb);
            self.rgb.as_slice()
        } else if !swaps.is_empty() {
            self.rgb.clear();
            self.rgb.extend_from_slice(&frame.rgb);
            for (idx, pixel) in self.rgb.chunks_exact_mut(RGB_CHANNELS).enumerate() {
                if let Some(color) = crate::view::remap_color(
                    pixel,
                    idx as u32 % frame.width,
                    idx as u32 / frame.width,
                    swaps,
                ) {
                    pixel.copy_from_slice(&color);
                }
            }
            self.rgb.as_slice()
        } else {
            frame.rgb.as_slice()
        };
        let (pixels, channels): (&[u8], usize) =
            if spec.grayscale_order == GrayscaleOrder::BeforeResize {
                grayscale_into(pixels, spec.grayscale_order, &mut self.gray);
                (self.gray.as_slice(), 1)
            } else {
                (pixels, RGB_CHANNELS)
            };
        // The plan was prepared above and retains identical OpenCV accumulation order.
        let plan: &ResizePlan = self.plan.as_ref().expect("Resize plan was prepared");
        if channels == RGB_CHANNELS {
            resize_channels(pixels, plan, channels, &mut self.rows, &mut self.resized);
            grayscale_into(&self.resized, spec.grayscale_order, out);
        } else {
            resize_channels(pixels, plan, channels, &mut self.rows, out);
        }
    }
}
struct ResizePlan {
    shape: [usize; 4],
    mirror: bool,
    horizontal: AxisWeights,
    vertical: AxisWeights,
}
impl ResizePlan {
    fn new(shape: [usize; 4], mirror: bool) -> Self {
        let [src_width, src_height, width, height]: [usize; 4] = shape;
        let mut horizontal: AxisWeights = area_weights(src_width, width);
        if mirror {
            for weights in &mut horizontal {
                for (x, _) in weights {
                    *x = src_width - *x - 1;
                }
            }
        }
        Self {
            shape,
            mirror,
            horizontal,
            vertical: area_weights(src_height, height),
        }
    }
}
fn resize_channels(
    pixels: &[u8],
    plan: &ResizePlan,
    channels: usize,
    rows: &mut Vec<f32>,
    out: &mut Vec<u8>,
) {
    let [src_width, src_height, width, height]: [usize; 4] = plan.shape;
    rows.resize(src_height * width * channels, 0.0);
    for src_y in 0..src_height {
        for (x, weights) in plan.horizontal.iter().enumerate() {
            for channel in 0..channels {
                rows[(src_y * width + x) * channels + channel] =
                    weights
                        .iter()
                        .fold(0.0_f32, |sum: f32, &(src_x, alpha): &(usize, f32)| {
                            sum + f32::from(
                                pixels[(src_y * src_width + src_x) * channels + channel],
                            ) * alpha
                        });
            }
        }
    }
    out.resize(width * height * channels, 0);
    for (y, weights) in plan.vertical.iter().enumerate() {
        for x in 0..width * channels {
            let sum: f32 =
                weights
                    .iter()
                    .fold(0.0_f32, |sum: f32, &(src_y, beta): &(usize, f32)| {
                        sum + rows[src_y * width * channels + x] * beta
                    });
            out[y * width * channels + x] = sum.round_ties_even().clamp(0.0, 255.0) as u8;
        }
    }
}
fn grayscale_into(pixels: &[u8], order: GrayscaleOrder, dest: &mut Vec<u8>) {
    dest.clear();
    dest.extend(
        pixels
            .chunks_exact(RGB_CHANNELS)
            .map(|pixel: &[u8]| grayscale(pixel, order)),
    );
}
fn grayscale(pixel: &[u8], order: GrayscaleOrder) -> u8 {
    // Keep legacy policy coefficients; use OpenCV's 15-bit RGB conversion
    // for the resize-then-grayscale pipeline used by Sample Factory.
    let (red, green, blue, shift): (u32, u32, u32, u32) = match order {
        GrayscaleOrder::BeforeResize => (4899, 9617, 1868, 14),
        GrayscaleOrder::AfterResize => (9798, 19235, 3735, 15),
    };
    ((u32::from(pixel[0]) * red
        + u32::from(pixel[1]) * green
        + u32::from(pixel[2]) * blue
        + (1 << (shift - 1)))
        >> shift) as u8
}
fn area_weights(src: usize, dest: usize) -> AxisWeights {
    let scale: f64 = src as f64 / dest as f64;
    (0..dest)
        .map(|idx: usize| {
            let start: f64 = idx as f64 * scale;
            let end: f64 = start + scale;
            let cell: f64 = scale.min(src as f64 - start);
            let last: usize = (end.floor() as usize).min(src - 1);
            let first: usize = (start.ceil() as usize).min(last);
            let mut weights: Vec<(usize, f32)> = Vec::new();
            if first as f64 - start > 1e-3 {
                weights.push((first - 1, ((first as f64 - start) / cell) as f32));
            }
            for sx in first..last {
                weights.push((sx, (1.0 / cell) as f32));
            }
            if end - last as f64 > 1e-3 {
                weights.push((last, ((end - last as f64).min(1.0).min(cell) / cell) as f32));
            }
            weights
        })
        .collect()
}
