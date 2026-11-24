![image](https://github.com/JamesClarke7283/TauriLeptosTemplate/assets/78018345/e5f0d309-13f0-4e6e-b4d3-df9e979779ea)



# Tauri Leptos Example (With TailwindCSS)

- [Tauri][tauri_web]
- [Leptos][leptos_repo]

See [Prerequisites](#prerequisites) section.

## Prerequisites

The build uses Trunk from `PATH`. Install any missing Rust build tools with Cargo.

```sh
cargo install --locked tauri-cli --version '=2.12.1'
cargo install --locked trunk --version '=0.22.2'
```

Install Rust via rustup and the [Tauri desktop system prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system. `rust-toolchain.toml` specifies Rust stable and the
`wasm32-unknown-unknown` target. Trunk uses the Tailwind CSS v4 CLI from
`PATH` when available and fetches the standalone CLI when needed.
Node.js and npm are unnecessary.

## Running

### Run in Dev mode

```bash
cargo tauri dev
```

### Build in Production

```bash
cargo tauri build
```

The default build compiles the Leptos frontend, attempts an ARM64 Android
APK and AAB, then packages the desktop application. If Android setup or
packaging fails, the build warns and continues with desktop packaging. The
Android SDK, NDK, Java, and signing credentials are optional for desktop builds.
Use `TAURI_BUILD_MOBILE=false cargo tauri build` to skip the Android attempt.
In PowerShell, set `$env:TAURI_BUILD_MOBILE = 'false'` before building.

To include iOS on macOS, install the iOS prerequisites below and run
`TAURI_BUILD_MOBILE=true cargo tauri build` in Bash. In PowerShell, set
`$env:TAURI_BUILD_MOBILE = 'true'` before building.
The hook installs the ARM64 Rust targets and initializes missing native projects.
Passing `--debug` applies to every bundle built by the command.
Explicit `cargo tauri android build` commands still exit with an error if Android packaging fails.

If you generated a native project with the old npm CLI, back up any native
customizations, move that platform's directory out of `src-tauri/gen/`, and
rerun its Cargo init command below. Reapply your customizations to the newly
generated project so its Gradle or Xcode build calls `cargo tauri`.

### Android

Install Android Studio, its command-line tools, and Java 21 using the
[Android prerequisites](https://v2.tauri.app/start/prerequisites/#android).
Set `JAVA_HOME` to your Java installation and `ANDROID_HOME` to your Android SDK.
With `sdkmanager` on your PATH, install the versions used by CI:

```sh
sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;37.0.0" "ndk;28.2.13676358"
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"

# Create this app's private release signing key (once)
cargo xtask android-signing init

# Generate the native project and install Android Rust targets (once)
cargo tauri android init

# Build release APK and AAB for ARM64 devices
cargo tauri android build --ci --target aarch64 --apk --aab
```

The signed APK and AAB are under `src-tauri/gen/android/app/build/outputs/apk/`
and `src-tauri/gen/android/app/build/outputs/bundle/`. Install the APK on an
ARM64 device running Android 7.0 or newer; the AAB is for app distribution tools.
Android refuses to install unsigned APKs.

Keep Android signing material in the repository's `keys/` folder. The setup
command creates these private files:

```text
keys/
  release.jks        # Persistent Android release signing key
  credentials.json   # Key alias, key password and keystore password
```

The entire `keys/` directory is excluded by `.gitignore`; do not commit or share
these files. Back up both files securely: future updates must use the same key.
Running `cargo xtask android-signing init` again preserves an existing key.
Release builds automatically load these credentials and fail clearly if signing
is missing. Debug builds use Android's debug signing instead.

If you already have a signing key, put the keystore in `keys/` and set
`ANDROID_KEYSTORE_PATH` to its path (for example, `keys/release.jks`), along with
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and `ANDROID_STORE_PASSWORD`.
These environment variables override the generated local credentials. See
[Android signing](https://v2.tauri.app/distribute/sign/android/).

To use the same key in GitHub Actions, authenticate the GitHub CLI (`gh`) and run:

```sh
cargo xtask android-signing github
```

This stores `ANDROID_KEY_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`,
and `ANDROID_STORE_PASSWORD` as Actions secrets in the current repository.
CI restores the same private keystore for each build; it never generates a new
signing key. After restoring a backup on another computer, keep both files in
that checkout's `keys/` folder to sign compatible updates.

If installation still says "App Not Installed", connect the device with USB
debugging enabled and run `adb install -r /path/to/app.apk` to see the exact
reason. A signature mismatch means an installed copy uses another key. Use its
original key to update it; uninstalling that copy removes its app data.

Android requires a positive version code. Keep the versions in
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` in sync with the release
tag when releasing, and increase the version for each update.

### iOS (macOS only)

Install Xcode with the iOS SDK and simulator runtime, select it as the active
developer directory, and follow the
[iOS prerequisites](https://v2.tauri.app/start/prerequisites/#ios).

```sh
brew install xcodegen cocoapods libimobiledevice

# Generate the native project and install iOS Rust targets (once)
cargo tauri ios init

# Build an unsigned release IPA for ARM64 iOS devices
cargo tauri ios build --ci --target aarch64 --no-sign
```

The IPA is under `src-tauri/gen/apple/build/arm64/`. This compiles without an
Apple development team or signing secrets. Device installation, TestFlight,
and App Store distribution require [iOS signing](https://v2.tauri.app/distribute/sign/ios/).

### GitHub Actions

The `release` workflow builds all eight platform/architecture combinations:

| Target | Runner | Release artifacts |
| --- | --- | --- |
| Linux x86_64 and ARM64 | Ubuntu | AppImage, DEB and RPM |
| Windows x86_64 and ARM64 | Windows | MSI |
| macOS Intel x86_64 and Apple Silicon ARM64 | macOS | DMG and app archives |
| Android ARM64 | Ubuntu | Signed release APK and AAB |
| iOS ARM64 | macOS with Xcode | Unsigned release IPA |

Run it manually on a branch from the Actions tab to download workflow artifacts,
or push a `v*` tag to publish all packages on the GitHub Releases page. Tag builds attach
desktop packages to a draft release while building. After every platform build
succeeds, the final job attaches the APK, AAB and IPA, then automatically
publishes the completed release. A failed build or upload leaves it unpublished.
The Intel and Apple Silicon macOS packages have separate architecture names.

Android release builds require the four Actions secrets above. CI reconstructs
the keystore, signs the APK and AAB, and verifies them before upload. iOS
compilation uses unsigned packages and does not require signing secrets.
CI installs the SDKs and Rust targets, then initializes each native project before
building. The generated projects under `src-tauri/gen/` are ignored by this
template; keep any native customization in version control and update the
initialization step if you start maintaining them.

## Credits

All credit for the counter example in [`./src-ui/src/lib.rs`](src-ui/src/lib.rs)
goes to authors and contributors of [gbj/leptos][leptos_repo] GitHub repository,
[MIT License][leptos_license], Copyright 2022 Greg Johnston.

[tauri_web]: https://tauri.app/
[leptos_repo]: https://github.com/gbj/leptos
[leptos_nightly_note]: https://github.com/gbj/leptos#nightly-note
[leptos_license]: https://github.com/gbj/leptos/blob/e465867b30db8fccce7493f9fc913359246ac4bd/LICENSE
