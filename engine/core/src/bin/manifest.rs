#[cfg(not(target_arch = "wasm32"))]
mod native {
    use arena_core::{ArenaError, Manifest, Result};
    use std::{env, fs, path::PathBuf};
    pub fn main() {
        if let Err(error) = run() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
    fn run() -> Result<()> {
        let mut args: std::iter::Skip<env::ArgsOs> = env::args_os().skip(1);
        let src: PathBuf = args
            .next()
            .map(PathBuf::from)
            .ok_or_else(|| ArenaError::Request("Expected source catalog and output file".into()))?;
        let dest: PathBuf = args
            .next()
            .map(PathBuf::from)
            .ok_or_else(|| ArenaError::Request("Expected output file".into()))?;
        if args.next().is_some() {
            return Err(ArenaError::Request("Expected two paths".into()));
        }
        let manifest: Manifest = Manifest::load(src)?;
        let bytes: Vec<u8> = serde_json::to_vec_pretty(&manifest)
            .map_err(|error: serde_json::Error| ArenaError::Configuration(error.to_string()))?;
        fs::write(dest, bytes).map_err(|error: std::io::Error| ArenaError::Host(error.to_string()))
    }
}
#[cfg(not(target_arch = "wasm32"))]
fn main() {
    native::main();
}
#[cfg(target_arch = "wasm32")]
fn main() {
    eprintln!("Catalog compilation requires a native filesystem");
}
