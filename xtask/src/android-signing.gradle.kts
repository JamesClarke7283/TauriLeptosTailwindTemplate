// BEGIN TEMPLATE ANDROID SIGNING
val templateKeystoreFile = rootProject.file("keystore.properties")
if (templateKeystoreFile.exists()) {
    val templateKeystore = TemplateSigningProperties().apply {
        templateKeystoreFile.inputStream().use { load(it) }
    }
    android {
        signingConfigs {
            create("templateRelease") {
                storeFile = file(templateKeystore.getProperty("storeFile"))
                storePassword = templateKeystore.getProperty("storePassword")
                keyAlias = templateKeystore.getProperty("keyAlias")
                keyPassword = templateKeystore.getProperty("keyPassword")
            }
        }
        buildTypes.getByName("release") {
            signingConfig = signingConfigs.getByName("templateRelease")
        }
    }
}
// END TEMPLATE ANDROID SIGNING
