![image](https://github.com/JamesClarke7283/TauriLeptosTemplate/assets/78018345/e5f0d309-13f0-4e6e-b4d3-df9e979779ea)



# Tauri Leptos Example (With TailwindCSS)

- [Tauri][tauri_web]
- [Leptos][leptos_repo]

See [Prerequisites](#prerequisites) section.

```sh
# Build and develop for desktop
cargo tauri dev

# Build and release for desktop
cargo tauri build
```

## Prerequisites

```sh
# Tauri CLI
cargo install --locked tauri-cli@2.1.0

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

# Optional: `tailwindcss` for UI styling
npm install --global tailwindcss
```

## Running

### Run in Dev mode

```bash
cargo tauri dev
```

### Build in Production

```bash
cargo tauri build
```

## Credits

All credit for the counter example in [`./src-ui/src/lib.rs`](src-ui/src/lib.rs)
goes to authors and contributors of [gbj/leptos][leptos_repo] GitHub repository,
[MIT License][leptos_license], Copyright 2022 Greg Johnston.

[tauri_web]: https://tauri.app/
[leptos_repo]: https://github.com/gbj/leptos
[leptos_nightly_note]: https://github.com/gbj/leptos#nightly-note
[leptos_license]: https://github.com/gbj/leptos/blob/e465867b30db8fccce7493f9fc913359246ac4bd/LICENSE
