use std::{env, path::Path, process::Command};

use anyhow::Result;

use crate::{android_signing, run};

const FRONTEND_READY: &str = "TAURI_TEMPLATE_FRONTEND_READY";

struct Build {
    platform: String,
    host: &'static str,
    debug: bool,
    frontend_ready: bool,
    build_mobile: bool,
}

pub fn before_build(root: &Path) -> Result<()> {
    let build = Build {
        platform: env::var("TAURI_ENV_PLATFORM").unwrap_or_default(),
        host: env::consts::OS,
        debug: env::var("TAURI_ENV_DEBUG").as_deref() == Ok("true"),
        frontend_ready: env::var(FRONTEND_READY).as_deref() == Ok("1"),
        build_mobile: matches!(env::var("TAURI_BUILD_MOBILE").as_deref(), Ok("true" | "1")),
    };
    build.run(root, run, android_signing::configure)
}

impl Build {
    fn run(
        &self,
        root: &Path,
        mut run: impl FnMut(&mut Command) -> Result<()>,
        configure_android: impl FnOnce(&Path) -> Result<()>,
    ) -> Result<()> {
        let mobile = matches!(self.platform.as_str(), "android" | "ios");
        if self.platform == "android" && !self.debug {
            configure_android(root)?;
        }

        // A mobile build launched by the desktop hook uses the same frontend.
        if !mobile || !self.frontend_ready {
            let mut trunk = Command::new("trunk");
            trunk.current_dir(root).arg("build");
            if !self.debug {
                trunk.arg("--release");
            }
            run(&mut trunk)?;
        }
        if mobile || !self.build_mobile {
            return Ok(());
        }

        println!("Building Android APK/AAB (ARM64)...");
        self.build_mobile(root, ANDROID, &mut run)?;
        if self.host == "macos" {
            println!("Building iOS IPA (ARM64)...");
            self.build_mobile(root, IOS, &mut run)?;
        } else {
            println!(
                "iOS IPA requires macOS and Xcode. Use this command on macOS or the GitHub iOS build job."
            );
        }
        Ok(())
    }

    fn build_mobile(
        &self,
        root: &Path,
        mobile: Mobile,
        run: &mut impl FnMut(&mut Command) -> Result<()>,
    ) -> Result<()> {
        run(Command::new("rustup")
            .current_dir(root)
            .args(["target", "add", mobile.target]))?;

        let tauri = || {
            let mut command = Command::new("cargo");
            command
                .current_dir(root)
                .env(FRONTEND_READY, "1")
                // Desktop configuration overrides should stay with the desktop build.
                .env_remove("TAURI_CONFIG")
                .args(["tauri", mobile.platform]);
            command
        };
        if !root.join(mobile.marker).exists() {
            run(tauri().args(["init", "--ci", "--skip-targets-install"]))?;
        }
        let mut build = tauri();
        build
            .args(["build", "--ci", "--target", "aarch64"])
            .args(mobile.bundle_args);
        if self.debug {
            build.arg("--debug");
        }
        run(&mut build)
    }
}

struct Mobile {
    platform: &'static str,
    target: &'static str,
    marker: &'static str,
    bundle_args: &'static [&'static str],
}

const ANDROID: Mobile = Mobile {
    platform: "android",
    target: "aarch64-linux-android",
    marker: "src-tauri/gen/android/gradlew",
    bundle_args: &["--apk", "--aab"],
};

const IOS: Mobile = Mobile {
    platform: "ios",
    target: "aarch64-apple-ios",
    marker: "src-tauri/gen/apple/project.yml",
    bundle_args: &["--no-sign"],
};

#[cfg(test)]
mod tests;
