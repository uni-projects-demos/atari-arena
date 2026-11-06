mod onnx;
mod torch;

use crate::{ArenaError, Result};
use onnx::{Attribute, Graph};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fmt::Display};
use torch::Weights;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CheckpointFormat {
    Sb3Dqn,
    Sb3Ppo,
    SampleFactory,
}

pub fn checkpoint_to_onnx(bytes: &[u8], format: CheckpointFormat, actions: u32) -> Result<Vec<u8>> {
    if !(1..=18).contains(&actions) {
        return Err(invalid("Expected 1 to 18 discrete Atari actions"));
    }
    let sample_factory: bool = format == CheckpointFormat::SampleFactory;
    let mut weights: Weights<'_> = Weights::load(bytes, !sample_factory)?;
    let mut graph: Graph = Graph::policy();
    graph.floats(
        "pixel_scale",
        &[],
        &[if sample_factory { 1.0 / 255.0 } else { 255.0 }],
    );
    graph.node(
        if sample_factory { "Mul" } else { "Div" },
        &["observation", "pixel_scale"],
        "scaled",
        vec![],
    );
    let mut input: String = "scaled".into();
    if sample_factory {
        let mean: Vec<f32> = weights.tensor(
            "obs_normalizer.running_mean_std.running_mean_std.obs.running_mean",
            &[4, 84, 84],
        )?;
        let variance: Vec<f32> = weights.tensor(
            "obs_normalizer.running_mean_std.running_mean_std.obs.running_var",
            &[4, 84, 84],
        )?;
        if variance.iter().any(|val: &f32| *val < 0.0) {
            return Err(invalid("Negative observation variance"));
        }
        let deviation: Vec<f32> = variance
            .iter()
            .map(|val: &f32| (val + 1e-5).sqrt())
            .collect();
        graph.floats("observation_mean", &[4, 84, 84], &mean);
        graph.floats("observation_deviation", &[4, 84, 84], &deviation);
        graph.floats("clip_min", &[], &[-5.0]);
        graph.floats("clip_max", &[], &[5.0]);
        graph.node(
            "Reciprocal",
            &["observation_deviation"],
            "inverse_deviation",
            vec![],
        );
        graph.node("Sub", &["scaled", "observation_mean"], "centered", vec![]);
        graph.node(
            "Mul",
            &["centered", "inverse_deviation"],
            "standardized",
            vec![],
        );
        graph.node(
            "Clip",
            &["standardized", "clip_min", "clip_max"],
            "normalized",
            vec![],
        );
        input = "normalized".into();
    }
    let (convolution, linear, output): (&str, &str, &str) = match format {
        CheckpointFormat::SampleFactory => (
            "encoder.encoders.obs.enc.conv_head",
            "encoder.encoders.obs.enc.mlp_layers.0",
            "action_parameterization.distribution_linear",
        ),
        CheckpointFormat::Sb3Dqn => (
            "q_net.features_extractor.cnn",
            "q_net.features_extractor.linear.0",
            "q_net.q_net.0",
        ),
        CheckpointFormat::Sb3Ppo => (
            "features_extractor.cnn",
            "features_extractor.linear.0",
            "action_net",
        ),
    };
    let layers: [String; 5] = [
        format!("{convolution}.0"),
        format!("{convolution}.2"),
        format!("{convolution}.4"),
        linear.into(),
        output.into(),
    ];
    let expected: BTreeSet<String> = layers
        .iter()
        .flat_map(|name: &String| [format!("{name}.weight"), format!("{name}.bias")])
        .collect();
    let ignored: &str = match format {
        CheckpointFormat::SampleFactory => "critic_linear.",
        CheckpointFormat::Sb3Dqn => "q_net_target.",
        CheckpointFormat::Sb3Ppo => "value_net.",
    };
    weights.validate_parameters(&expected, ignored)?;
    for (idx, channels, kernel, stride) in
        [(0, [32, 4], 8, 4), (2, [64, 32], 4, 2), (4, [64, 64], 3, 1)]
    {
        let name: String = format!("{convolution}.{idx}");
        let layer: String = format!("conv_{idx}");
        let shape: [usize; 4] = [channels[0], channels[1], kernel, kernel];
        parameters(&mut weights, &mut graph, &name, &layer, &shape)?;
        graph.node(
            "Conv",
            &[&input, &format!("{layer}_weight"), &format!("{layer}_bias")],
            &layer,
            vec![Attribute::integers("strides", &[stride, stride])],
        );
        input = format!("{layer}_relu");
        graph.node("Relu", &[&layer], &input, vec![]);
    }
    graph.node(
        "Flatten",
        &[&input],
        "flattened",
        vec![Attribute::integer("axis", 1)],
    );
    parameters(&mut weights, &mut graph, linear, "hidden", &[512, 3136])?;
    graph.node(
        "Gemm",
        &["flattened", "hidden_weight", "hidden_bias"],
        "hidden",
        vec![Attribute::integer("transB", 1)],
    );
    graph.node("Relu", &["hidden"], "features", vec![]);
    parameters(
        &mut weights,
        &mut graph,
        output,
        "actor",
        &[actions as usize, 512],
    )?;
    graph.node(
        "Gemm",
        &["features", "actor_weight", "actor_bias"],
        "logits",
        vec![Attribute::integer("transB", 1)],
    );
    graph.node(
        "ArgMax",
        &["logits"],
        "action",
        vec![
            Attribute::integer("axis", 1),
            Attribute::integer("keepdims", 0),
        ],
    );
    Ok(graph.encode())
}
fn parameters(
    weights: &mut Weights<'_>,
    graph: &mut Graph,
    src: &str,
    name: &str,
    shape: &[usize],
) -> Result<()> {
    let weight: Vec<f32> = weights.tensor(&format!("{src}.weight"), shape)?;
    let bias: Vec<f32> = weights.tensor(&format!("{src}.bias"), &[shape[0]])?;
    graph.floats(&format!("{name}_weight"), shape, &weight);
    graph.floats(&format!("{name}_bias"), &[shape[0]], &bias);
    Ok(())
}
fn invalid(msg: impl Display) -> ArenaError {
    ArenaError::Inference(format!("Unsupported Atari checkpoint: {msg}"))
}
