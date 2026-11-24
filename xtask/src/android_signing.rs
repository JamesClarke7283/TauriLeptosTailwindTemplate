use std::{
    env,
    fs::{self, DirBuilder},
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use anyhow::{Context, Result, ensure};
use base64::prelude::*;
use serde_json::{Value, json};
use tempfile::{NamedTempFile, TempPath};

use crate::{check_status, run};

const PROPERTIES_IMPORT: &str = "import java.util.Properties as TemplateSigningProperties";
const BEGIN_MARKER: &str = "// BEGIN TEMPLATE ANDROID SIGNING";
const END_MARKER: &str = "// END TEMPLATE ANDROID SIGNING";
const GRADLE_SIGNING: &str = include_str!("android-signing.gradle.kts");
const SIGNING_VARS: [&str; 4] = [
    "ANDROID_KEYSTORE_PATH",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
    "ANDROID_STORE_PASSWORD",
];

#[derive(Debug, PartialEq)]
struct Credentials {
    store_file: PathBuf,
    key_alias: String,
    key_password: String,
    store_password: String,
}

fn credentials(root: &Path, read_env: impl Fn(&str) -> Option<String>) -> Result<Credentials> {
    let fields = SIGNING_VARS.map(read_env);
    let credentials = if fields.iter().any(Option::is_some) {
        let [
            Some(path),
            Some(key_alias),
            Some(key_password),
            Some(store_password),
        ] = fields.map(|value| value.filter(|value| !value.is_empty()))
        else {
            anyhow::bail!(
                "Android signing requires all of: {}.",
                SIGNING_VARS.join(", ")
            );
        };
        Credentials {
            store_file: root.join(path),
            key_alias,
            key_password,
            store_password,
        }
    } else {
        let source = fs::read(root.join("keys/credentials.json")).map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                anyhow::anyhow!(
                    "Android release signing is not configured. Run cargo xtask android-signing init locally, then cargo xtask android-signing github for CI."
                )
            } else {
                anyhow::Error::new(error).context("Could not read keys/credentials.json")
            }
        })?;
        let stored: Value = serde_json::from_slice(&source).map_err(|_| {
            anyhow::anyhow!(
                "keys/credentials.json is invalid. Restore the credentials for your existing signing key."
            )
        })?;
        let field = |name| -> Result<String> {
            stored
                .get(name)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .with_context(|| format!("Android signing is missing {name}."))
        };
        Credentials {
            store_file: root.join("keys/release.jks"),
            key_alias: field("keyAlias")?,
            key_password: field("keyPassword")?,
            store_password: field("storePassword")?,
        }
    };
    ensure!(
        credentials.store_file.is_file(),
        "Android signing keystore was not found. Restore your existing key or check ANDROID_KEYSTORE_PATH."
    );
    Ok(credentials)
}

// Java Properties uses ISO-8859-1 and \u escapes for UTF-16 code units.
fn property_value(value: &str) -> String {
    let mut escaped = String::new();
    for unit in value.encode_utf16() {
        match unit {
            0x0a => escaped.push_str("\\n"),
            0x0d => escaped.push_str("\\r"),
            0x09 => escaped.push_str("\\t"),
            0x20..=0x7e => {
                let character = char::from(unit as u8);
                if "\\ :=#!".contains(character) {
                    escaped.push('\\');
                }
                escaped.push(character);
            }
            _ => {
                use std::fmt::Write as _;
                write!(escaped, "\\u{unit:04x}").unwrap();
            }
        }
    }
    escaped
}

pub fn configure(root: &Path) -> Result<()> {
    configure_with(root, signing_env)
}

fn signing_env(name: &str) -> Option<String> {
    // Treat a non-Unicode value as invalid rather than falling back to the local key.
    env::var_os(name).map(|value| value.into_string().unwrap_or_default())
}

fn configure_with(root: &Path, read_env: impl Fn(&str) -> Option<String>) -> Result<()> {
    let credentials = credentials(root, read_env)?;
    let android = root.join("src-tauri/gen/android");
    let gradle = android.join("app/build.gradle.kts");
    let source = fs::read_to_string(&gradle).context("Could not read Android app/build.gradle.kts. Run cargo tauri android init if the native project is missing.")?;
    let block = GRADLE_SIGNING.trim_end();
    let mut updated = match (source.find(BEGIN_MARKER), source.find(END_MARKER)) {
        (None, None) => format!("{}\n\n{block}\n", source.trim_end()),
        (Some(start), Some(end)) if start < end => {
            format!(
                "{}{block}{}",
                &source[..start],
                &source[end + END_MARKER.len()..]
            )
        }
        _ => anyhow::bail!("Android signing markers are incomplete in app/build.gradle.kts."),
    };
    if !updated.contains(PROPERTIES_IMPORT) {
        updated.insert_str(0, &format!("{PROPERTIES_IMPORT}\n"));
    }

    let store_file = credentials
        .store_file
        .to_str()
        .context("Android keystore path must be Unicode")?;
    let mut properties = NamedTempFile::new_in(&android)?;
    for (name, value) in [
        ("storeFile", store_file),
        ("keyAlias", &credentials.key_alias),
        ("keyPassword", &credentials.key_password),
        ("storePassword", &credentials.store_password),
    ] {
        writeln!(properties, "{name}={}", property_value(value))?;
    }
    properties
        .persist(android.join("keystore.properties"))
        .context("Could not write Android signing properties")?;
    if updated != source {
        fs::write(gradle, updated).context("Could not update Android app/build.gradle.kts")?;
    }
    Ok(())
}

pub fn initialize(root: &Path) -> Result<()> {
    let keys = root.join("keys");
    let keystore = keys.join("release.jks");
    let credentials_file = keys.join("credentials.json");
    if keystore.exists() || credentials_file.exists() {
        credentials(root, signing_env)?;
        println!("Existing Android signing key preserved.");
        return Ok(());
    }

    let mut directory = DirBuilder::new();
    directory.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory.mode(0o700);
    }
    directory.create(&keys)?;
    let temp = tempfile::tempdir_in(&keys)?;
    let staged_key = temp.path().join("release.jks");
    let mut random = [0u8; 32];
    getrandom::fill(&mut random)
        .map_err(|error| anyhow::anyhow!("Could not generate a signing password: {error}"))?;
    let password = BASE64_URL_SAFE_NO_PAD.encode(random);
    let keytool_name = if cfg!(windows) {
        "keytool.exe"
    } else {
        "keytool"
    };
    let keytool = env::var_os("JAVA_HOME")
        .filter(|path| !path.is_empty())
        .map_or_else(
            || PathBuf::from(keytool_name),
            |home| PathBuf::from(home).join("bin").join(keytool_name),
        );
    run(Command::new(keytool)
        .current_dir(root)
        .env("TAURI_KEYTOOL_PASSWORD", &password)
        .args(["-genkeypair", "-noprompt", "-keystore"])
        .arg(&staged_key)
        .args([
            "-storetype",
            "PKCS12",
            "-alias",
            "upload",
            "-keyalg",
            "RSA",
            "-keysize",
            "4096",
            "-validity",
            "10000",
            "-dname",
            "CN=Android Release",
            "-storepass:env",
            "TAURI_KEYTOOL_PASSWORD",
            "-keypass:env",
            "TAURI_KEYTOOL_PASSWORD",
        ]))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&staged_key, fs::Permissions::from_mode(0o600))?;
    }

    let mut staged_credentials = NamedTempFile::new_in(&keys)?;
    serde_json::to_writer_pretty(
        &mut staged_credentials,
        &json!({
            "keyAlias": "upload",
            "keyPassword": password,
            "storePassword": password,
        }),
    )?;
    writeln!(staged_credentials)?;

    TempPath::try_from_path(staged_key)?.persist_noclobber(&keystore)?;
    if let Err(error) = staged_credentials.persist_noclobber(credentials_file) {
        fs::remove_file(&keystore).context("Could not roll back the new Android keystore")?;
        return Err(error).context("Could not save Android signing credentials");
    }
    println!(
        "Created keys/release.jks and credentials.json. Back up both privately to sign future updates."
    );
    Ok(())
}

pub fn configure_github(root: &Path) -> Result<()> {
    let credentials = credentials(root, signing_env)?;
    for (name, value) in [
        (
            "ANDROID_KEY_BASE64",
            BASE64_STANDARD.encode(fs::read(credentials.store_file)?),
        ),
        ("ANDROID_KEY_ALIAS", credentials.key_alias),
        ("ANDROID_KEY_PASSWORD", credentials.key_password),
        ("ANDROID_STORE_PASSWORD", credentials.store_password),
    ] {
        let mut command = Command::new("gh")
            .current_dir(root)
            .args(["secret", "set", name])
            .stdin(Stdio::piped())
            .spawn()
            .context("Could not run gh")?;
        let input = command.stdin.take().unwrap().write_all(value.as_bytes());
        check_status("gh", command.wait()?)?;
        input.context("Could not write signing secret to gh")?;
    }
    println!("Android signing secrets configured for this GitHub repository.");
    Ok(())
}

#[cfg(test)]
mod tests;
