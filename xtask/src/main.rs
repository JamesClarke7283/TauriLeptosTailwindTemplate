mod android_signing;
mod build;

use std::{env, path::Path, process::Command};

use anyhow::{Context, Result, bail};

fn main() -> Result<()> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let mut args = env::args().skip(1);
    match (args.next().as_deref(), args.next().as_deref(), args.next()) {
        (Some("before-build"), None, None) => build::before_build(root),
        (Some("android-signing"), Some("init"), None) => android_signing::initialize(root),
        (Some("android-signing"), Some("github"), None) => android_signing::configure_github(root),
        (Some("android-signing"), Some("configure"), None) => android_signing::configure(root),
        _ => bail!("Usage: cargo xtask before-build | android-signing <init|github|configure>"),
    }
}

fn run(command: &mut Command) -> Result<()> {
    let program = command.get_program().to_string_lossy().into_owned();
    let status = command
        .status()
        .with_context(|| format!("Could not run {program}"))?;
    check_status(&program, status)
}

fn check_status(program: &str, status: std::process::ExitStatus) -> Result<()> {
    anyhow::ensure!(status.success(), "{program} failed ({status})");
    Ok(())
}
