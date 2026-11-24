use super::*;
use std::{ffi::OsStr, fs};

fn desktop(host: &'static str) -> Build {
    Build {
        platform: host.to_owned(),
        host,
        debug: false,
        frontend_ready: false,
        build_mobile: false,
    }
}

fn command_line(command: &Command) -> String {
    std::iter::once(command.get_program())
        .chain(command.get_args())
        .map(OsStr::to_str)
        .map(Option::unwrap)
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn regular_desktop_builds_only_build_the_frontend() {
    for host in ["linux", "windows", "macos"] {
        desktop(host)
            .run(
                Path::new("."),
                |command| {
                    assert_eq!(command_line(command), "trunk build --release");
                    Ok(())
                },
                |_| panic!("desktop builds do not sign Android bundles"),
            )
            .unwrap();
    }
}

#[test]
fn opt_in_initializes_missing_projects_and_builds_the_supported_bundles() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let gradlew = root.join(ANDROID.marker);
    fs::create_dir_all(gradlew.parent().unwrap()).unwrap();
    fs::write(gradlew, "").unwrap();

    for host in ["linux", "windows", "macos"] {
        let build = Build {
            build_mobile: true,
            debug: true,
            ..desktop(host)
        };
        let mut commands = Vec::new();
        build
            .run(
                root,
                |command| {
                    assert_eq!(command.get_current_dir(), Some(root));
                    if command.get_program() == "cargo" {
                        let overrides: Vec<_> = command.get_envs().collect();
                        assert!(overrides.contains(&(OsStr::new("TAURI_CONFIG"), None)));
                        assert!(
                            overrides
                                .contains(&(OsStr::new(FRONTEND_READY), Some(OsStr::new("1"))))
                        );
                    }
                    commands.push(command_line(command));
                    Ok(())
                },
                |_| panic!("the Android child signs its own bundles"),
            )
            .unwrap();
        let mut expected = vec![
            "trunk build",
            "rustup target add aarch64-linux-android",
            "cargo tauri android build --ci --target aarch64 --apk --aab --debug",
        ];
        if host == "macos" {
            expected.extend([
                "rustup target add aarch64-apple-ios",
                "cargo tauri ios init --ci --skip-targets-install",
                "cargo tauri ios build --ci --target aarch64 --no-sign --debug",
            ]);
        }
        assert_eq!(commands, expected);
    }
}

#[test]
fn mobile_hooks_never_recurse_and_sign_android_release_before_the_frontend() {
    for platform in ["android", "ios"] {
        for debug in [false, true] {
            for frontend_ready in [false, true] {
                let build = Build {
                    platform: platform.to_owned(),
                    debug,
                    frontend_ready,
                    build_mobile: true,
                    ..desktop("macos")
                };
                let signed = std::cell::Cell::new(false);
                let sign = platform == "android" && !debug;
                let mut commands = Vec::new();
                build
                    .run(
                        Path::new("."),
                        |command| {
                            assert_eq!(signed.get(), sign);
                            commands.push(command_line(command));
                            Ok(())
                        },
                        |_| {
                            signed.set(true);
                            Ok(())
                        },
                    )
                    .unwrap();
                let expected = if frontend_ready {
                    vec![]
                } else if debug {
                    vec!["trunk build"]
                } else {
                    vec!["trunk build --release"]
                };
                assert_eq!(commands, expected);
                assert_eq!(signed.get(), sign);
            }
        }
    }
}

#[test]
fn stops_at_the_first_failed_command() {
    let temp = tempfile::tempdir().unwrap();
    let build = Build {
        build_mobile: true,
        ..desktop("macos")
    };
    for fail_at in 1..=4 {
        let mut count = 0;
        let error = build
            .run(
                temp.path(),
                |_| {
                    count += 1;
                    anyhow::ensure!(count != fail_at, "command failed");
                    Ok(())
                },
                |_| panic!("desktop builds do not sign Android bundles"),
            )
            .unwrap_err();
        assert_eq!(count, fail_at);
        assert_eq!(error.to_string(), "command failed");
    }
}
