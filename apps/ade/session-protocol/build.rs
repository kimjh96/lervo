//! Generates the Rust types of both protocols from the JSON Schema documents that
//! `@lervo/session-host-contract` exports: the session-host protocol and the core link.

use std::error::Error;
use std::fs;
use std::path::PathBuf;

use typify::{TypeSpace, TypeSpaceSettings};

fn main() -> Result<(), Box<dyn Error>> {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let generated = manifest.join("../../../packages/session-host-contract/generated");
    let out = PathBuf::from(std::env::var("OUT_DIR")?);
    for (document, module) in [
        ("session-host-protocol.schema.json", "protocol.rs"),
        ("core-link-protocol.schema.json", "core_link.rs"),
    ] {
        let path = generated.join(document);
        println!("cargo::rerun-if-changed={}", path.display());
        let schema: schemars::schema::RootSchema =
            serde_json::from_str(&fs::read_to_string(&path)?)?;
        let mut space = TypeSpace::new(&TypeSpaceSettings::default());
        space.add_root_schema(schema)?;
        let file: syn::File = syn::parse2(space.to_stream()?)?;
        fs::write(out.join(module), prettyplease::unparse(&file))?;
    }
    Ok(())
}
