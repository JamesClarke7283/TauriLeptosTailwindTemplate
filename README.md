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

# Create the app's private Android signing key (once, after prerequisites)
npm run android:signing:init

# Build desktop and Android packages (also iOS on macOS)
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
Install the Android prerequisites and configure signing below before using the
default release build command.
On macOS, also install the iOS prerequisites to generate all three platforms.
If you prefer `cargo tauri build`, install the matching Cargo CLI with
`cargo install tauri-cli --version '=2.12.1' --locked`.

## Running

### Run in Dev mode

```bash
npm run tauri -- dev
```

### Build in Production

```bash
npm run build
```

The same build runs with `npm run tauri -- build` or `cargo tauri build`.
Tauri's build hook builds the Leptos frontend, installs the ARM64 Rust targets,
and initializes missing native projects. It creates an Android APK and AAB,
then an unsigned iOS IPA on macOS, before Tauri builds the desktop application.
The default build uses release mode; `--debug` also applies to the mobile builds.

iOS packaging requires macOS and Xcode. On Linux and Windows, the command
creates desktop and Android packages and reports that iOS needs macOS.
The GitHub workflow builds iOS on its macOS runner.

For a desktop-only build without an Android SDK, use
`TAURI_BUILD_MOBILE=false npm run build` in Bash, or set
`$env:TAURI_BUILD_MOBILE = 'false'` before building in PowerShell.

### Android

Install Android Studio, its command-line tools, and Java 21 using the
[Android prerequisites](https://v2.tauri.app/start/prerequisites/#android).
Set `JAVA_HOME` to your Java installation and `ANDROID_HOME` to your Android SDK.
With `sdkmanager` on your PATH, install the versions used by CI:

```sh
sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;37.0.0" "ndk;28.2.13676358"
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"

# Create this app's private release signing key (once)
npm run android:signing:init

# Generate the native project and install Android Rust targets (once)
npm run tauri -- android init

# Build release APK and AAB for ARM64 devices
npm run build:android -- --ci --target aarch64 --apk --aab
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
Running `npm run android:signing:init` again preserves an existing key.
Release builds automatically load these credentials and fail clearly if signing
is missing. Debug builds use Android's debug signing instead.

If you already have a signing key, put the keystore in `keys/` and set
`ANDROID_KEYSTORE_PATH` to its path (for example, `keys/release.jks`), along with
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and `ANDROID_STORE_PASSWORD`.
These environment variables override the generated local credentials. See
[Android signing](https://v2.tauri.app/distribute/sign/android/).

To use the same key in GitHub Actions, authenticate the GitHub CLI (`gh`) and run:

```sh
npm run android:signing:github
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
Desktop CI jobs set `TAURI_BUILD_MOBILE=false` because the mobile jobs create
their packages separately on the appropriate runners.

## Credits

All credit for the counter example in [`./src-ui/src/lib.rs`](src-ui/src/lib.rs)
goes to authors and contributors of [gbj/leptos][leptos_repo] GitHub repository,
[MIT License][leptos_license], Copyright 2022 Greg Johnston.

[tauri_web]: https://tauri.app/
[leptos_repo]: https://github.com/gbj/leptos
[leptos_nightly_note]: https://github.com/gbj/leptos#nightly-note
[leptos_license]: https://github.com/gbj/leptos/blob/e465867b30db8fccce7493f9fc913359246ac4bd/LICENSE
