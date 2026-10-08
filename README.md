![image](https://github.com/JamesClarke7283/TauriLeptosTemplate/assets/78018345/e5f0d309-13f0-4e6e-b4d3-df9e979779ea)



# Tauri Leptos Example (With TailwindCSS)

- [Tauri][tauri_web]
- [Leptos][leptos_repo]

See [Prerequisites](#prerequisites) section.

```sh
# Install the locked Tauri CLI and npm dependencies
npm ci

# Develop for desktop
npm run tauri -- dev

# Build for desktop
npm run build
```

## Prerequisites

```sh
# Tauri CLI (installed locally from package-lock.json)
npm ci

# Rust stable (required by Leptos)
rustup toolchain install stable --allow-downgrade

# WASM target
rustup target add wasm32-unknown-unknown

# Trunk WASM bundler
cargo install --locked trunk

# `wasm-bindgen` for Apple M1 chips (required by Trunk)
cargo install --locked wasm-bindgen-cli

# `esbuild` as dependency of `tauri-sys` crate (used in UI)
npm install --global --save-exact esbuild

# Tailwind CSS CLI (required by the Trunk build hook)
npm install --global tailwindcss @tailwindcss/cli
```

Also install the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system. The npm scripts use the pinned Tauri CLI, including
support for unsigned iOS builds.

## Running

### Run in Dev mode

```bash
npm run tauri -- dev
```

### Build in Production

```bash
npm run build
```

Tauri builds the Leptos frontend with `trunk build --release` before compiling
the desktop or mobile application.

### Android

Install Android Studio, its command-line tools, and Java 21 using the
[Android prerequisites](https://v2.tauri.app/start/prerequisites/#android).
Set `JAVA_HOME` to your Java installation and `ANDROID_HOME` to your Android SDK.
With `sdkmanager` on your PATH, install the versions used by CI:

```sh
sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;37.0.0" "ndk;28.2.13676358"
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"

# Generate the native project and install Android Rust targets (once)
npm run tauri -- android init

# Build release APK and AAB for ARM64 devices
npm run build:android -- --ci --target aarch64 --apk --aab
```

The outputs are under `src-tauri/gen/android/app/build/outputs/apk/` and
`src-tauri/gen/android/app/build/outputs/bundle/`. These release bundles are
unsigned until you configure [Android signing](https://v2.tauri.app/distribute/sign/android/).
The template starts at version `0.0.1` because Android requires a positive
version code. Keep the versions in `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` in sync when releasing.

### iOS (macOS only)

Install Xcode with the iOS SDK and simulator runtime, select it as the active
developer directory, and follow the
[iOS prerequisites](https://v2.tauri.app/start/prerequisites/#ios).

```sh
brew install xcodegen cocoapods libimobiledevice

# Generate the native project and install iOS Rust targets (once)
npm run tauri -- ios init

# Build an unsigned release IPA for ARM64 iOS devices
npm run build:ios -- --ci --target aarch64 --no-sign
```

The IPA is under `src-tauri/gen/apple/build/arm64/`. This compiles without an
Apple development team or signing secrets. Device installation, TestFlight,
and App Store distribution require [iOS signing](https://v2.tauri.app/distribute/sign/ios/).

### GitHub Actions

The `release` workflow builds the desktop targets plus Android and iOS:

| Target | Runner | Mobile artifacts |
| --- | --- | --- |
| Android ARM64 | Ubuntu | Unsigned release APK and AAB |
| iOS ARM64 | macOS with Xcode | Unsigned release IPA |

Run it manually from the Actions tab to download workflow artifacts, or push a
`v*` tag to attach all bundles to a draft GitHub Release. Mobile compilation
does not require signing secrets. CI installs the SDKs and Rust targets, then
initializes each native project before building. The generated projects under
`src-tauri/gen/` are ignored by this template; keep any native customization in
version control and update the initialization step if you start maintaining them.

## Credits

All credit for the counter example in [`./src-ui/src/lib.rs`](src-ui/src/lib.rs)
goes to authors and contributors of [gbj/leptos][leptos_repo] GitHub repository,
[MIT License][leptos_license], Copyright 2022 Greg Johnston.

[tauri_web]: https://tauri.app/
[leptos_repo]: https://github.com/gbj/leptos
[leptos_nightly_note]: https://github.com/gbj/leptos#nightly-note
[leptos_license]: https://github.com/gbj/leptos/blob/e465867b30db8fccce7493f9fc913359246ac4bd/LICENSE
