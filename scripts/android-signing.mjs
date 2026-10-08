import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const signingDirectory = 'keys';
const propertiesImport = 'import java.util.Properties as TemplateSigningProperties';
const beginMarker = '// BEGIN TEMPLATE ANDROID SIGNING';
const endMarker = '// END TEMPLATE ANDROID SIGNING';
const gradleSigning = `${beginMarker}
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
${endMarker}`;

function run(command, args, { env = process.env, input } = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status}).`);
}

export function signingCredentials({ root = projectRoot, env = process.env } = {}) {
  const fields = ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_STORE_PASSWORD'];
  let credentials;
  if (fields.some((field) => env[field] !== undefined)) {
    if (fields.some((field) => !env[field])) {
      throw new Error(`Android signing requires all of: ${fields.join(', ')}.`);
    }
    credentials = {
      storeFile: resolve(root, env.ANDROID_KEYSTORE_PATH),
      keyAlias: env.ANDROID_KEY_ALIAS,
      keyPassword: env.ANDROID_KEY_PASSWORD,
      storePassword: env.ANDROID_STORE_PASSWORD,
    };
  } else {
    const credentialsPath = join(root, signingDirectory, 'credentials.json');
    if (!existsSync(credentialsPath)) {
      throw new Error('Android release signing is not configured. Run npm run android:signing:init locally, then npm run android:signing:github for CI.');
    }
    let stored;
    try {
      stored = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    } catch {
      throw new Error('keys/credentials.json is invalid. Restore the credentials for your existing signing key.');
    }
    credentials = {
      ...stored,
      storeFile: join(root, signingDirectory, 'release.jks'),
    };
  }
  for (const field of ['storeFile', 'keyAlias', 'keyPassword', 'storePassword']) {
    if (typeof credentials[field] !== 'string' || !credentials[field]) {
      throw new Error(`Android signing is missing ${field}.`);
    }
  }
  if (!existsSync(credentials.storeFile)) throw new Error('Android signing keystore was not found. Restore your existing key or check ANDROID_KEYSTORE_PATH.');
  return credentials;
}

// java.util.Properties reads ISO-8859-1 and treats backslashes as escapes.
export function propertyValue(value) {
  return value.replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    .replace(/([^\x20-\x7e])/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/([ :=#!])/g, '\\$1');
}

export function configureAndroidSigning({ root = projectRoot, env = process.env } = {}) {
  const credentials = signingCredentials({ root, env });
  const androidRoot = join(root, 'src-tauri', 'gen', 'android');
  const gradlePath = join(androidRoot, 'app', 'build.gradle.kts');
  const source = readFileSync(gradlePath, 'utf8');
  const markerStart = source.indexOf(beginMarker);
  const markerEnd = source.indexOf(endMarker);
  if ((markerStart === -1) !== (markerEnd === -1) || markerEnd < markerStart) {
    throw new Error('Android signing markers are incomplete in app/build.gradle.kts.');
  }
  let updated = markerStart === -1
    ? `${source.trimEnd()}\n\n${gradleSigning}\n`
    : source.slice(0, markerStart) + gradleSigning + source.slice(markerEnd + endMarker.length);
  if (!updated.includes(propertiesImport)) updated = `${propertiesImport}\n${updated}`;
  const propertiesPath = join(androidRoot, 'keystore.properties');
  writeFileSync(propertiesPath, Object.entries(credentials)
    .map(([key, value]) => `${key}=${propertyValue(value)}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(propertiesPath, 0o600);
  if (updated !== source) writeFileSync(gradlePath, updated);
}

function initializeSigning() {
  const directory = join(projectRoot, signingDirectory);
  const keystore = join(directory, 'release.jks');
  const credentialsPath = join(directory, 'credentials.json');
  if (existsSync(keystore) || existsSync(credentialsPath)) {
    signingCredentials();
    console.log('Existing Android signing key preserved.');
    return;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const password = randomBytes(32).toString('base64url');
  const keytool = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool')
    : 'keytool';
  run(keytool, [
    '-genkeypair', '-noprompt', '-keystore', keystore, '-storetype', 'PKCS12',
    '-alias', 'upload', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000',
    '-dname', 'CN=Android Release', '-storepass:env', 'TAURI_KEYTOOL_PASSWORD',
    '-keypass:env', 'TAURI_KEYTOOL_PASSWORD',
  ], { env: { ...process.env, TAURI_KEYTOOL_PASSWORD: password } });
  chmodSync(keystore, 0o600);
  writeFileSync(credentialsPath, JSON.stringify({
    keyAlias: 'upload', keyPassword: password, storePassword: password,
  }, null, 2) + '\n', { mode: 0o600 });
  console.log('Created keys/release.jks and credentials.json. Back up both privately; future updates must reuse this key.');
}

function configureGitHubSecrets() {
  const credentials = signingCredentials();
  for (const [name, value] of Object.entries({
    ANDROID_KEY_BASE64: readFileSync(credentials.storeFile).toString('base64'),
    ANDROID_KEY_ALIAS: credentials.keyAlias,
    ANDROID_KEY_PASSWORD: credentials.keyPassword,
    ANDROID_STORE_PASSWORD: credentials.storePassword,
  })) {
    run('gh', ['secret', 'set', name], { input: value });
  }
  console.log('Android signing secrets configured for this GitHub repository.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'init') initializeSigning();
    else if (process.argv[2] === 'github') configureGitHubSecrets();
    else if (process.argv[2] === 'configure') configureAndroidSigning();
    else throw new Error('Expected init, github, or configure.');
  } catch (error) {
    console.error(`Android signing failed: ${error.message}`);
    process.exitCode = 1;
  }
}
