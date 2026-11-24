use super::*;

fn fixture() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("keys")).unwrap();
    fs::create_dir_all(temp.path().join("src-tauri/gen/android/app")).unwrap();
    temp
}

fn write_local_key(root: &Path) {
    fs::write(root.join("keys/release.jks"), "fake keystore").unwrap();
    // The original helper stored these JSON fields. The extra path must be ignored.
    fs::write(
        root.join("keys/credentials.json"),
        r#"{"storeFile":"ignored.jks","keyAlias":"upload","keyPassword":" leading!\\\n","storePassword":"clé 🚀"}"#,
    )
    .unwrap();
}

#[test]
fn existing_keys_work_and_a_complete_signing_environment_takes_precedence() {
    let temp = fixture();
    let root = temp.path();
    write_local_key(root);
    let local = credentials(root, |_| None).unwrap();
    assert_eq!(local.store_file, root.join("keys/release.jks"));
    assert_eq!(local.key_password, " leading!\\\n");
    assert_eq!(local.store_password, "clé 🚀");

    fs::write(root.join("ci.jks"), "CI fixture").unwrap();
    let remote = credentials(root, |name| {
        SIGNING_VARS
            .iter()
            .position(|var| *var == name)
            .map(|index| {
                ["ci.jks", "ci-alias", "ci-key-password", "ci-store-password"][index].to_owned()
            })
    })
    .unwrap();
    assert_eq!(remote.store_file, root.join("ci.jks"));
    assert_eq!(remote.key_alias, "ci-alias");
    assert!(
        credentials(root, |name| (name == "ANDROID_KEY_ALIAS").then(String::new))
            .unwrap_err()
            .to_string()
            .contains("requires all of")
    );
}

#[test]
fn missing_or_invalid_credentials_fail_without_disclosing_their_contents() {
    let temp = fixture();
    let root = temp.path();
    let error = credentials(root, |_| None).unwrap_err().to_string();
    assert!(error.contains("cargo xtask android-signing init"));
    write_local_key(root);
    fs::remove_file(root.join("keys/release.jks")).unwrap();
    assert!(
        credentials(root, |_| None)
            .unwrap_err()
            .to_string()
            .contains("keystore was not found")
    );
    fs::write(
        root.join("keys/credentials.json"),
        r#"{"private-secret" INVALID}"#,
    )
    .unwrap();
    let error = credentials(root, |_| None).unwrap_err().to_string();
    assert!(error.contains("credentials.json is invalid"));
    assert!(!error.contains("private-secret"));
}

#[test]
fn java_properties_escape_paths_whitespace_and_unicode() {
    assert_eq!(
        property_value("C:\\Release Team\\clé:=#!\r\t\n\u{000c}🚀"),
        r"C\:\\Release\ Team\\cl\u00e9\:\=\#\!\r\t\n\u000c\ud83d\ude80"
    );
}

#[test]
fn configuring_signing_updates_gradle_once_and_writes_private_properties() {
    let temp = fixture();
    let root = temp.path();
    write_local_key(root);
    let android = root.join("src-tauri/gen/android");
    let gradle = android.join("app/build.gradle.kts");
    let original = "android { defaultConfig { minSdk = 26 } }\n";
    fs::write(&gradle, original).unwrap();
    let properties = android.join("keystore.properties");
    fs::write(&properties, "old=test").unwrap();
    configure_with(root, |_| None).unwrap();
    let updated = fs::read_to_string(&gradle).unwrap();
    assert!(updated.starts_with(PROPERTIES_IMPORT));
    assert!(updated.contains(original));
    assert!(updated.contains("signingConfig = signingConfigs.getByName(\"templateRelease\")"));
    let with_customization = format!("{updated}// custom code after signing\n");
    fs::write(&gradle, &with_customization).unwrap();
    configure_with(root, |_| None).unwrap();
    assert_eq!(fs::read_to_string(&gradle).unwrap(), with_customization);
    let properties_text = fs::read_to_string(&properties).unwrap();
    assert!(properties_text.contains("storePassword=cl\\u00e9\\ \\ud83d\\ude80\n"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(properties).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn invalid_gradle_markers_leave_the_native_project_untouched() {
    let temp = fixture();
    let root = temp.path();
    write_local_key(root);
    let android = root.join("src-tauri/gen/android");
    let gradle = android.join("app/build.gradle.kts");
    for original in [
        BEGIN_MARKER.to_owned(),
        END_MARKER.to_owned(),
        format!("{END_MARKER}\n{BEGIN_MARKER}"),
    ] {
        fs::write(&gradle, &original).unwrap();
        assert!(
            configure_with(root, |_| None)
                .unwrap_err()
                .to_string()
                .contains("markers are incomplete")
        );
        assert_eq!(fs::read_to_string(&gradle).unwrap(), original);
        assert!(!android.join("keystore.properties").exists());
    }
}
