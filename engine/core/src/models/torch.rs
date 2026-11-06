use super::invalid;
use crate::Result;
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Read},
};
use zip::ZipArchive;

const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;
const MAX_STORAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES: usize = 100 * 1024 * 1024;
const MAX_NODES: usize = 100_000;
const MARK: usize = usize::MAX;

#[derive(Clone, Debug)]
struct Storage {
    key: String,
    dtype: String,
    elements: usize,
}
#[derive(Clone, Debug)]
struct Tensor {
    storage: Storage,
    offset: usize,
    shape: Vec<usize>,
    stride: Vec<usize>,
}
#[derive(Debug)]
enum Value {
    Other,
    Integer(i64),
    Text(String),
    Global(String),
    Sequence(Vec<usize>),
    Dictionary(Vec<(usize, usize)>),
    Storage(Storage),
    Tensor(Tensor),
}
struct Pickle<'a> {
    data: &'a [u8],
    pos: usize,
    nodes: Vec<Value>,
    stack: Vec<usize>,
    memo: BTreeMap<usize, usize>,
}
impl<'a> Pickle<'a> {
    fn parse(data: &'a [u8]) -> Result<(Vec<Value>, usize)> {
        if data.len() > MAX_METADATA_BYTES {
            return Err(invalid("Checkpoint metadata exceeds its size limit"));
        }
        let mut parser: Self = Self {
            data,
            pos: 0,
            nodes: Vec::new(),
            stack: Vec::new(),
            memo: BTreeMap::new(),
        };
        for _ in 0..MAX_NODES * 10 {
            let opcode: u8 = parser.read(1)?[0];
            match opcode {
                0x80 => {
                    if parser.read(1)?[0] > 5 {
                        return Err(invalid("Unsupported checkpoint pickle protocol"));
                    }
                }
                0x95 => {
                    let len: usize = parser.length(8)?;
                    if len > parser.data.len() - parser.pos {
                        return Err(invalid("Truncated checkpoint frame"));
                    }
                }
                b'.' => {
                    let root: usize = parser.pop()?;
                    if !parser.stack.is_empty() {
                        return Err(invalid("Invalid checkpoint root"));
                    }
                    return Ok((parser.nodes, root));
                }
                b'(' => parser.stack.push(MARK),
                b'N' | 0x88 | 0x89 => parser.push(Value::Other)?,
                b'K' => {
                    let val: i64 = i64::from(parser.read(1)?[0]);
                    parser.push(Value::Integer(val))?;
                }
                b'M' => {
                    let val: i64 = parser.length(2)? as i64;
                    parser.push(Value::Integer(val))?;
                }
                b'J' => {
                    let val: i64 =
                        i64::from(i32::from_le_bytes(parser.read(4)?.try_into().unwrap()));
                    parser.push(Value::Integer(val))?;
                }
                0x8a | 0x8b => {
                    let len: usize = if opcode == 0x8a {
                        parser.length(1)?
                    } else {
                        parser.length(4)?
                    };
                    if len > 8 {
                        return Err(invalid("Checkpoint integer is too large"));
                    }
                    let bytes: &[u8] = parser.read(len)?;
                    let mut integer: [u8; 8] =
                        [if bytes.last().is_some_and(|val: &u8| val & 128 != 0) {
                            255
                        } else {
                            0
                        }; 8];
                    integer[..len].copy_from_slice(bytes);
                    parser.push(Value::Integer(i64::from_le_bytes(integer)))?;
                }
                b'G' => {
                    parser.read(8)?;
                    parser.push(Value::Other)?;
                }
                b'X' | 0x8c | 0x8d => {
                    let width: usize = match opcode {
                        0x8c => 1,
                        0x8d => 8,
                        _ => 4,
                    };
                    let len: usize = parser.length(width)?;
                    let txt: String = std::str::from_utf8(parser.read(len)?)
                        .map_err(|_| invalid("Invalid checkpoint text"))?
                        .into();
                    parser.push(Value::Text(txt))?;
                }
                b'B' | b'C' | 0x8e | 0x96 => {
                    let width: usize = match opcode {
                        b'C' => 1,
                        0x8e | 0x96 => 8,
                        _ => 4,
                    };
                    let len: usize = parser.length(width)?;
                    parser.read(len)?;
                    parser.push(Value::Other)?;
                }
                b'c' => {
                    let module: String = parser.line()?.into();
                    let name: String = parser.line()?.into();
                    parser.push(Value::Global(format!("{module}.{name}")))?;
                }
                0x93 => {
                    let name: usize = parser.pop()?;
                    let module: usize = parser.pop()?;
                    let name: String = format!("{}.{}", parser.text(module)?, parser.text(name)?);
                    parser.push(Value::Global(name))?;
                }
                b')' | b']' => parser.push(Value::Sequence(Vec::new()))?,
                b'}' => parser.push(Value::Dictionary(Vec::new()))?,
                b't' | b'l' => {
                    let vals: Vec<usize> = parser.marked()?;
                    parser.push(Value::Sequence(vals))?;
                }
                0x85..=0x87 => {
                    let count: usize = usize::from(opcode - 0x84);
                    if parser.stack.len() < count {
                        return Err(invalid("Invalid checkpoint tuple"));
                    }
                    let vals: Vec<usize> = parser.stack.split_off(parser.stack.len() - count);
                    if vals.contains(&MARK) {
                        return Err(invalid("Invalid checkpoint tuple marker"));
                    }
                    parser.push(Value::Sequence(vals))?;
                }
                b'a' | b'e' => {
                    let vals: Vec<usize> = if opcode == b'a' {
                        vec![parser.pop()?]
                    } else {
                        parser.marked()?
                    };
                    let target: usize = parser.top()?;
                    let Value::Sequence(sequence) = &mut parser.nodes[target] else {
                        return Err(invalid("Invalid checkpoint list"));
                    };
                    sequence.extend(vals);
                }
                b's' | b'u' | b'd' => {
                    let vals: Vec<usize> = if opcode == b's' {
                        let val: usize = parser.pop()?;
                        vec![parser.pop()?, val]
                    } else {
                        parser.marked()?
                    };
                    if vals.len() % 2 != 0 {
                        return Err(invalid("Invalid checkpoint dictionary entries"));
                    }
                    if opcode == b'd' {
                        parser.push(Value::Dictionary(Vec::new()))?;
                    }
                    let target: usize = parser.top()?;
                    let Value::Dictionary(dictionary) = &mut parser.nodes[target] else {
                        return Err(invalid("Invalid checkpoint dictionary"));
                    };
                    dictionary.extend(
                        vals.chunks_exact(2)
                            .map(|pair: &[usize]| (pair[0], pair[1])),
                    );
                }
                b'q' | b'r' | 0x94 => {
                    let idx: usize = if opcode == 0x94 {
                        parser.memo.len()
                    } else {
                        parser.length(if opcode == b'q' { 1 } else { 4 })?
                    };
                    if idx >= MAX_NODES {
                        return Err(invalid("Checkpoint memo exceeds its limit"));
                    }
                    parser.memo.insert(idx, parser.top()?);
                }
                b'h' | b'j' => {
                    let idx: usize = parser.length(if opcode == b'h' { 1 } else { 4 })?;
                    let val: usize = *parser
                        .memo
                        .get(&idx)
                        .ok_or_else(|| invalid("Missing checkpoint memo entry"))?;
                    parser.stack.push(val);
                }
                b'Q' => {
                    let val: usize = parser.pop()?;
                    let items: &[usize] = parser.sequence(val)?;
                    if items.len() < 5 || parser.text(items[0])? != "storage" {
                        return Err(invalid("Unsupported checkpoint persistent object"));
                    }
                    let dtype: String = parser.global(items[1])?.into();
                    let storage: Storage = Storage {
                        key: parser.text(items[2])?.into(),
                        dtype,
                        elements: parser.unsigned(items[4])?,
                    };
                    if storage.key.contains('/')
                        || storage.key.contains('\\')
                        || storage.key == ".."
                    {
                        return Err(invalid("Invalid checkpoint storage key"));
                    }
                    parser.push(Value::Storage(storage))?;
                }
                b'R' | 0x81 => {
                    let args: usize = parser.pop()?;
                    let func: usize = parser.pop()?;
                    let val: Value = parser.reduce(func, args)?;
                    parser.push(val)?;
                }
                b'b' => {
                    // Object state is metadata. It never changes a tensor's bytes or runs code.
                    parser.pop()?;
                    parser.top()?;
                }
                b'0' => {
                    parser.pop()?;
                }
                b'1' => {
                    parser.marked()?;
                }
                b'2' => {
                    let val: usize = parser.top()?;
                    parser.stack.push(val);
                }
                _ => {
                    return Err(invalid(format!(
                        "Unsupported checkpoint opcode: {opcode:#x}"
                    )));
                }
            }
            if parser.stack.len() > MAX_NODES {
                return Err(invalid("Checkpoint stack exceeds its limit"));
            }
        }
        Err(invalid("Checkpoint operation limit exceeded"))
    }
    fn reduce(&self, func: usize, args: usize) -> Result<Value> {
        let name: &str = self.global(func)?;
        let args: &[usize] = self.sequence(args)?;
        if name == "collections.OrderedDict" {
            return Ok(Value::Dictionary(Vec::new()));
        }
        if matches!(
            name,
            "torch._utils._rebuild_tensor_v2"
                | "torch._utils._rebuild_tensor"
                | "torch._utils._rebuild_tensor_v3"
        ) {
            if args.len() < 4 {
                return Err(invalid("Incomplete tensor descriptor"));
            }
            let Value::Storage(storage) = &self.nodes[args[0]] else {
                return Err(invalid("Missing tensor storage"));
            };
            let tensor: Tensor = Tensor {
                storage: storage.clone(),
                offset: self.unsigned(args[1])?,
                shape: self.dimensions(args[2])?,
                stride: self.dimensions(args[3])?,
            };
            if tensor.shape.len() != tensor.stride.len() || tensor.shape.len() > 8 {
                return Err(invalid("Invalid tensor dimensions"));
            }
            return Ok(Value::Tensor(tensor));
        }
        if name == "torch._utils._rebuild_parameter" {
            if let Some(&arg) = args.first() {
                if let Value::Tensor(tensor) = &self.nodes[arg] {
                    return Ok(Value::Tensor(tensor.clone()));
                }
            }
            return Err(invalid("Invalid checkpoint parameter"));
        }
        // Optimizer and NumPy metadata are opaque, never callable.
        Ok(Value::Other)
    }
    fn dimensions(&self, id: usize) -> Result<Vec<usize>> {
        self.sequence(id)?
            .iter()
            .map(|&val: &usize| self.unsigned(val))
            .collect()
    }
    fn unsigned(&self, id: usize) -> Result<usize> {
        match self.nodes.get(id) {
            Some(Value::Integer(val)) => {
                usize::try_from(*val).map_err(|_| invalid("Invalid tensor index"))
            }
            _ => Err(invalid("Expected a checkpoint integer")),
        }
    }
    fn text(&self, id: usize) -> Result<&str> {
        match self.nodes.get(id) {
            Some(Value::Text(txt)) => Ok(txt),
            _ => Err(invalid("Expected checkpoint text")),
        }
    }
    fn global(&self, id: usize) -> Result<&str> {
        match self.nodes.get(id) {
            Some(Value::Global(name)) => Ok(name),
            _ => Err(invalid("Expected a checkpoint symbol")),
        }
    }
    fn sequence(&self, id: usize) -> Result<&[usize]> {
        match self.nodes.get(id) {
            Some(Value::Sequence(items)) => Ok(items),
            _ => Err(invalid("Expected a checkpoint sequence")),
        }
    }
    fn push(&mut self, val: Value) -> Result<()> {
        if self.nodes.len() >= MAX_NODES {
            return Err(invalid("Checkpoint object limit exceeded"));
        }
        self.stack.push(self.nodes.len());
        self.nodes.push(val);
        Ok(())
    }
    fn top(&self) -> Result<usize> {
        self.stack
            .last()
            .copied()
            .filter(|val: &usize| *val != MARK)
            .ok_or_else(|| invalid("Missing checkpoint operand"))
    }
    fn pop(&mut self) -> Result<usize> {
        self.stack
            .pop()
            .filter(|val: &usize| *val != MARK)
            .ok_or_else(|| invalid("Missing checkpoint operand"))
    }
    fn marked(&mut self) -> Result<Vec<usize>> {
        let mark: usize = self
            .stack
            .iter()
            .rposition(|val: &usize| *val == MARK)
            .ok_or_else(|| invalid("Missing checkpoint marker"))?;
        let vals: Vec<usize> = self.stack.split_off(mark + 1);
        self.stack.pop();
        Ok(vals)
    }
    fn read(&mut self, len: usize) -> Result<&'a [u8]> {
        let end: usize = self
            .pos
            .checked_add(len)
            .ok_or_else(|| invalid("Checkpoint length overflow"))?;
        let bytes: &'a [u8] = self
            .data
            .get(self.pos..end)
            .ok_or_else(|| invalid("Truncated checkpoint"))?;
        self.pos = end;
        Ok(bytes)
    }
    fn length(&mut self, width: usize) -> Result<usize> {
        let mut val: [u8; 8] = [0; 8];
        val[..width].copy_from_slice(self.read(width)?);
        usize::try_from(u64::from_le_bytes(val)).map_err(|_| invalid("Checkpoint length overflow"))
    }
    fn line(&mut self) -> Result<&'a str> {
        let len: usize = self.data[self.pos..]
            .iter()
            .position(|val: &u8| *val == b'\n')
            .ok_or_else(|| invalid("Truncated checkpoint symbol"))?;
        let bytes: &'a [u8] = self.read(len + 1)?;
        std::str::from_utf8(&bytes[..len]).map_err(|_| invalid("Invalid checkpoint symbol"))
    }
}

pub(super) struct Weights<'a> {
    archive: ZipArchive<Cursor<Cow<'a, [u8]>>>,
    prefix: String,
    tensors: BTreeMap<String, Tensor>,
}
impl<'a> Weights<'a> {
    pub fn validate_parameters(
        &self,
        expected: &BTreeSet<String>,
        ignored_prefix: &str,
    ) -> Result<()> {
        for name in self.tensors.keys() {
            if (name.ends_with(".weight") || name.ends_with(".bias"))
                && !expected.contains(name)
                && !name.starts_with(ignored_prefix)
            {
                return Err(invalid(format!("Unsupported policy layer: {name}")));
            }
        }
        Ok(())
    }
    pub fn load(bytes: &'a [u8], sb3: bool) -> Result<Self> {
        if bytes.is_empty() || bytes.len() > MAX_CHECKPOINT_BYTES {
            return Err(invalid("Invalid checkpoint size"));
        }
        let data: Cow<'a, [u8]> = if sb3 {
            let mut archive: ZipArchive<Cursor<&[u8]>> =
                ZipArchive::new(Cursor::new(bytes)).map_err(invalid)?;
            Cow::Owned(read_member(
                &mut archive,
                "policy.pth",
                MAX_CHECKPOINT_BYTES,
            )?)
        } else {
            Cow::Borrowed(bytes)
        };
        let mut archive: ZipArchive<Cursor<Cow<'a, [u8]>>> =
            ZipArchive::new(Cursor::new(data)).map_err(invalid)?;
        let names: Vec<String> = archive
            .file_names()
            .filter(|name: &&str| name.ends_with("/data.pkl") || *name == "data.pkl")
            .map(str::to_owned)
            .collect();
        if names.len() != 1 {
            return Err(invalid("Expected one PyTorch tensor archive"));
        }
        let prefix: String = names[0].trim_end_matches("data.pkl").into();
        if archive
            .file_names()
            .any(|name: &str| name == format!("{prefix}byteorder"))
            && read_member(&mut archive, &format!("{prefix}byteorder"), 16)? != b"little"
        {
            return Err(invalid("Only little-endian checkpoints are supported"));
        }
        let metadata: Vec<u8> = read_member(&mut archive, &names[0], MAX_METADATA_BYTES)?;
        let (nodes, root): (Vec<Value>, usize) = Pickle::parse(&metadata)?;
        let root: usize = if sb3 {
            root
        } else {
            dictionary_get(&nodes, root, "model")
                .ok_or_else(|| invalid("Missing Sample Factory model"))?
        };
        let Value::Dictionary(entries) = &nodes[root] else {
            return Err(invalid("Missing checkpoint state dictionary"));
        };
        let mut tensors: BTreeMap<String, Tensor> = BTreeMap::new();
        for &(key, val) in entries {
            if let (Value::Text(name), Value::Tensor(tensor)) = (&nodes[key], &nodes[val]) {
                if tensors.insert(name.clone(), tensor.clone()).is_some() {
                    return Err(invalid("Duplicate checkpoint tensor"));
                }
            }
        }
        if tensors.is_empty() {
            return Err(invalid("Checkpoint has no tensor weights"));
        }
        Ok(Self {
            archive,
            prefix,
            tensors,
        })
    }
    pub fn tensor(&mut self, name: &str, expected: &[usize]) -> Result<Vec<f32>> {
        let tensor: &Tensor = self
            .tensors
            .get(name)
            .ok_or_else(|| invalid(format!("Missing checkpoint tensor: {name}")))?;
        if tensor.shape != expected {
            return Err(invalid(format!(
                "Unexpected shape for {name}: {:?}",
                tensor.shape
            )));
        }
        let mut elements: usize = 1;
        for (&size, &stride) in tensor.shape.iter().zip(&tensor.stride).rev() {
            if size > 1 && stride != elements {
                return Err(invalid("Noncontiguous checkpoint tensor"));
            }
            elements = elements
                .checked_mul(size)
                .ok_or_else(|| invalid("Tensor size overflow"))?;
        }
        let width: usize = match tensor.storage.dtype.as_str() {
            "torch.FloatStorage" | "torch.cuda.FloatStorage" => 4,
            "torch.DoubleStorage" | "torch.cuda.DoubleStorage" => 8,
            _ => return Err(invalid("Expected float32 or float64 policy weights")),
        };
        let storage_bytes: usize = tensor
            .storage
            .elements
            .checked_mul(width)
            .filter(|len: &usize| *len <= MAX_STORAGE_BYTES)
            .ok_or_else(|| invalid("Tensor storage exceeds its limit"))?;
        let start: usize = tensor
            .offset
            .checked_mul(width)
            .ok_or_else(|| invalid("Tensor offset overflow"))?;
        let end: usize = elements
            .checked_mul(width)
            .and_then(|size: usize| start.checked_add(size))
            .filter(|end: &usize| *end <= storage_bytes)
            .ok_or_else(|| invalid("Tensor extends beyond its storage"))?;
        let key: String = format!("{}data/{}", self.prefix, tensor.storage.key);
        let bytes: Vec<u8> = read_member(&mut self.archive, &key, MAX_STORAGE_BYTES)?;
        if bytes.len() != storage_bytes {
            return Err(invalid("Tensor storage size mismatch"));
        }
        bytes[start..end]
            .chunks_exact(width)
            .map(|bytes: &[u8]| {
                let val: f32 = if width == 4 {
                    f32::from_le_bytes(bytes.try_into().unwrap())
                } else {
                    f64::from_le_bytes(bytes.try_into().unwrap()) as f32
                };
                if val.is_finite() {
                    Ok(val)
                } else {
                    Err(invalid("Non-finite policy weights"))
                }
            })
            .collect()
    }
}
fn dictionary_get(nodes: &[Value], id: usize, key: &str) -> Option<usize> {
    let Value::Dictionary(entries) = nodes.get(id)? else {
        return None;
    };
    entries.iter().find_map(|&(name, val): &(usize, usize)| {
        matches!(&nodes[name], Value::Text(txt) if txt == key).then_some(val)
    })
}
fn read_member<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    limit: usize,
) -> Result<Vec<u8>> {
    let entry: zip::read::ZipFile<'_, R> = archive.by_name(name).map_err(invalid)?;
    if entry.size() > limit as u64 {
        return Err(invalid("Checkpoint member exceeds its size limit"));
    }
    let mut bytes: Vec<u8> = Vec::new();
    entry
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(invalid)?;
    if bytes.len() > limit {
        return Err(invalid("Checkpoint member exceeds its size limit"));
    }
    Ok(bytes)
}
