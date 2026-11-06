use prost::Message;

#[derive(Clone, PartialEq, Message)]
pub(super) struct Model {
    #[prost(int64, tag = "1")]
    pub ir_version: i64,
    #[prost(string, tag = "2")]
    pub producer_name: String,
    #[prost(message, optional, tag = "7")]
    pub graph: Option<Graph>,
    #[prost(message, repeated, tag = "8")]
    pub opset_import: Vec<OperatorSet>,
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct OperatorSet {
    #[prost(string, tag = "1")]
    pub domain: String,
    #[prost(int64, tag = "2")]
    pub version: i64,
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct Graph {
    #[prost(message, repeated, tag = "1")]
    pub node: Vec<Node>,
    #[prost(string, tag = "2")]
    pub name: String,
    #[prost(message, repeated, tag = "5")]
    pub initializer: Vec<Tensor>,
    #[prost(message, repeated, tag = "11")]
    pub input: Vec<ValueInfo>,
    #[prost(message, repeated, tag = "12")]
    pub output: Vec<ValueInfo>,
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct Node {
    #[prost(string, repeated, tag = "1")]
    pub input: Vec<String>,
    #[prost(string, repeated, tag = "2")]
    pub output: Vec<String>,
    #[prost(string, tag = "4")]
    pub op_type: String,
    #[prost(message, repeated, tag = "5")]
    pub attribute: Vec<Attribute>,
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct Attribute {
    #[prost(string, tag = "1")]
    pub name: String,
    #[prost(int64, tag = "3")]
    pub i: i64,
    #[prost(int64, repeated, tag = "8")]
    pub ints: Vec<i64>,
    #[prost(int32, tag = "20")]
    pub r#type: i32,
}
impl Attribute {
    pub fn integer(name: &str, val: i64) -> Self {
        Self {
            name: name.into(),
            i: val,
            r#type: 2,
            ..Self::default()
        }
    }
    pub fn integers(name: &str, vals: &[i64]) -> Self {
        Self {
            name: name.into(),
            ints: vals.into(),
            r#type: 7,
            ..Self::default()
        }
    }
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct Tensor {
    #[prost(int64, repeated, tag = "1")]
    pub dims: Vec<i64>,
    #[prost(int32, tag = "2")]
    pub data_type: i32,
    #[prost(string, tag = "8")]
    pub name: String,
    #[prost(bytes = "vec", tag = "9")]
    pub raw_data: Vec<u8>,
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct ValueInfo {
    #[prost(string, tag = "1")]
    pub name: String,
    #[prost(message, optional, tag = "2")]
    pub r#type: Option<Type>,
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct Type {
    #[prost(message, optional, tag = "1")]
    pub tensor_type: Option<TensorType>,
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct TensorType {
    #[prost(int32, tag = "1")]
    pub elem_type: i32,
    #[prost(message, optional, tag = "2")]
    pub shape: Option<Shape>,
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct Shape {
    #[prost(message, repeated, tag = "1")]
    pub dim: Vec<Dimension>,
}
#[derive(Clone, PartialEq, Message)]
pub(super) struct Dimension {
    #[prost(int64, tag = "1")]
    pub dim_value: i64,
}
impl ValueInfo {
    pub fn tensor(name: &str, elem_type: i32, dims: &[i64]) -> Self {
        Self {
            name: name.into(),
            r#type: Some(Type {
                tensor_type: Some(TensorType {
                    elem_type,
                    shape: Some(Shape {
                        dim: dims
                            .iter()
                            .map(|&dim_value: &i64| Dimension { dim_value })
                            .collect(),
                    }),
                }),
            }),
        }
    }
}
impl Graph {
    pub fn policy() -> Self {
        Self {
            name: "atari-policy".into(),
            input: vec![ValueInfo::tensor("observation", 1, &[1, 4, 84, 84])],
            output: vec![ValueInfo::tensor("action", 7, &[1])],
            ..Self::default()
        }
    }
    pub fn floats(&mut self, name: &str, shape: &[usize], vals: &[f32]) {
        self.initializer.push(Tensor {
            name: name.into(),
            dims: shape.iter().map(|&size: &usize| size as i64).collect(),
            data_type: 1,
            raw_data: vals
                .iter()
                .flat_map(|val: &f32| val.to_le_bytes())
                .collect(),
        });
    }
    pub fn node(
        &mut self,
        operation: &str,
        inputs: &[&str],
        output: &str,
        attributes: Vec<Attribute>,
    ) {
        self.node.push(Node {
            input: inputs.iter().map(|&name: &&str| name.into()).collect(),
            output: vec![output.into()],
            op_type: operation.into(),
            attribute: attributes,
        });
    }
    pub fn encode(self) -> Vec<u8> {
        Model {
            ir_version: 8,
            producer_name: "atari-arena".into(),
            graph: Some(self),
            opset_import: vec![OperatorSet {
                domain: String::new(),
                version: 17,
            }],
        }
        .encode_to_vec()
    }
}
