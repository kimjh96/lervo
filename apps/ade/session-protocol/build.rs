//! Generates the protocol's Rust types from the JSON Schema document that
//! `@lervo/session-host-contract` exports.

use std::error::Error;
use std::fs;
use std::path::PathBuf;

use typify::{TypeSpace, TypeSpaceSettings};

fn main() -> Result<(), Box<dyn Error>> {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let document = manifest.join(
        "../../../packages/session-host-contract/generated/session-host-protocol.schema.json",
    );
    println!("cargo::rerun-if-changed={}", document.display());

    let schema: schemars::schema::RootSchema =
        serde_json::from_str(&fs::read_to_string(&document)?)?;
    let mut space = TypeSpace::new(&TypeSpaceSettings::default());
    space.add_root_schema(schema)?;

    let file: syn::File = syn::parse2(space.to_stream()?)?;
    let output = PathBuf::from(std::env::var("OUT_DIR")?).join("protocol.rs");
    fs::write(output, prettyplease::unparse(&file))?;
    Ok(())
}
