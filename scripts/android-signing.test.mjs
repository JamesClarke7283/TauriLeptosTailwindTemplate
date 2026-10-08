import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureAndroidSigning, propertyValue, signingCredentials } from './android-signing.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tauri-android-signing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const privateRoot = join(root, 'keys');
  const androidRoot = join(root, 'src-tauri', 'gen', 'android');
  const gradlePath = join(androidRoot, 'app', 'build.gradle.kts');
  mkdirSync(privateRoot, { recursive: true });
  mkdirSync(join(androidRoot, 'app'), { recursive: true });
  const credentials = {
    keyAlias: 'release', keyPassword: 'key-password', storePassword: 'store-password',
  };
  function localCredentials(value = credentials) {
    writeFileSync(join(privateRoot, 'credentials.json'), JSON.stringify(value));
    writeFileSync(join(privateRoot, 'release.jks'), 'fake keystore; no private key');
  }
  return { root, privateRoot, androidRoot, gradlePath, credentials, localCredentials };
}

// Decode the escape sequences understood by java.util.Properties values.
function decodeProperty(value) {
  return value.replace(/\\(u[\da-fA-F]{4}|.)/g, (_, escaped) => {
    if (escaped.startsWith('u')) return String.fromCharCode(Number.parseInt(escaped.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', f: '\f' })[escaped] ?? escaped;
  });
}

test('missing signing credentials gives actionable setup instructions', (t) => {
  const { root } = fixture(t);
  assert.throws(() => signingCredentials({ root, env: {} }), /not configured.*android:signing:init.*android:signing:github/);
});

test('partial or blank signing environment fails rather than falling back to a local key', (t) => {
  const { root, localCredentials } = fixture(t);
  localCredentials();
  for (const env of [
    { ANDROID_KEY_ALIAS: 'release' },
    { ANDROID_KEYSTORE_PATH: '' },
    { ANDROID_KEYSTORE_PATH: 'key.jks', ANDROID_KEY_ALIAS: 'release', ANDROID_KEY_PASSWORD: '', ANDROID_STORE_PASSWORD: 'store' },
  ]) {
    assert.throws(() => signingCredentials({ root, env }), /requires all of: ANDROID_KEYSTORE_PATH, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD, ANDROID_STORE_PASSWORD/);
  }
});

test('explicit environment credentials override the local key and resolve paths from the project root', (t) => {
  const { root, localCredentials } = fixture(t);
  localCredentials();
  writeFileSync(join(root, 'ci-key.jks'), 'fake CI keystore');
  const env = {
    ANDROID_KEYSTORE_PATH: 'ci-key.jks', ANDROID_KEY_ALIAS: 'ci-upload',
    ANDROID_KEY_PASSWORD: 'ci-key-pass', ANDROID_STORE_PASSWORD: 'ci-store-pass',
  };
  assert.deepEqual(signingCredentials({ root, env }), {
    storeFile: join(root, 'ci-key.jks'), keyAlias: 'ci-upload',
    keyPassword: 'ci-key-pass', storePassword: 'ci-store-pass',
  });
});

test('local credentials use the private project keystore and preserve credential characters', (t) => {
  const { root, privateRoot, localCredentials } = fixture(t);
  const credentials = { keyAlias: '发布', keyPassword: ' leading !:=\\\n', storePassword: 'secret#\t🚀' };
  localCredentials({ ...credentials, storeFile: '/untrusted/override.jks' });
  assert.deepEqual(signingCredentials({ root, env: {} }), {
    ...credentials, storeFile: join(privateRoot, 'release.jks'),
  });
});

test('missing keystore or malformed local credentials cannot produce a signed release', (t) => {
  const { root, privateRoot, localCredentials, credentials } = fixture(t);
  localCredentials();
  rmSync(join(privateRoot, 'release.jks'));
  assert.throws(() => signingCredentials({ root, env: {} }), /keystore was not found/);
  for (const [field, value] of [['keyAlias', ''], ['keyPassword', null], ['storePassword', 123]]) {
    localCredentials({ ...credentials, [field]: value });
    assert.throws(() => signingCredentials({ root, env: {} }), new RegExp(`missing ${field}`));
  }
});

test('invalid credentials JSON errors do not disclose its contents', (t) => {
  const { root, privateRoot } = fixture(t);
  const secret = 'private-password-that-must-not-be-logged';
  writeFileSync(join(privateRoot, 'credentials.json'), `{\"keyPassword\":\"${secret}\" invalid}`);
  assert.throws(() => signingCredentials({ root, env: {} }), (error) => {
    assert.match(error.message, /credentials.json is invalid/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
});

test('Java properties escaping round-trips paths, delimiters, whitespace and Unicode', () => {
  for (const [original, expected] of [
    ['C:\\Users\\Release Team\\upload.jks', 'C\\:\\\\Users\\\\Release\\ Team\\\\upload.jks'],
    [' leading :=#!', '\\ leading\\ \\:\\=\\#\\!'],
    ['line1\nline2\r\t\f', 'line1\\nline2\\r\\t\\u000c'],
    ['clé 发布 🚀', 'cl\\u00e9\\ \\u53d1\\u5e03\\ \\ud83d\\ude80'],
    ['literal\\n', 'literal\\\\n'],
  ]) {
    assert.equal(propertyValue(original), expected);
    assert.equal(decodeProperty(propertyValue(original)), original);
  }
});

test('signing injection is idempotent and preserves native project customization', (t) => {
  const { root, gradlePath, androidRoot, localCredentials, credentials, privateRoot } = fixture(t);
  localCredentials();
  const original = '// custom native configuration\nandroid { defaultConfig { minSdk = 26 } }\n';
  writeFileSync(gradlePath, original);
  configureAndroidSigning({ root, env: {} });
  const first = readFileSync(gradlePath, 'utf8');
  assert.ok(first.includes(original));
  assert.match(first, /^import java\.util\.Properties as TemplateSigningProperties\r?\n/);
  assert.match(first, /val templateKeystore = TemplateSigningProperties\(\)\.apply/);
  assert.equal(first.split('// BEGIN TEMPLATE ANDROID SIGNING').length - 1, 1);
  assert.match(first, /signingConfig = signingConfigs\.getByName\("templateRelease"\)/);
  assert.match(first, /templateKeystoreFile\.inputStream\(\)\.use/);
  const suffix = '// custom code after template signing\n';
  writeFileSync(gradlePath, first + suffix);
  configureAndroidSigning({ root, env: {} });
  assert.equal(readFileSync(gradlePath, 'utf8'), first + suffix);
  const properties = Object.fromEntries(readFileSync(join(androidRoot, 'keystore.properties'), 'utf8')
    .trimEnd().split('\n').map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), decodeProperty(line.slice(separator + 1))];
    }));
  assert.deepEqual(properties, { ...credentials, storeFile: join(privateRoot, 'release.jks') });
});

test('generated properties preserve secret characters and repair overly broad permissions', (t) => {
  const { root, gradlePath, androidRoot, localCredentials } = fixture(t);
  const credentials = { keyAlias: ' 发布:=#', keyPassword: 'a\\b\nc\rd\te🚀', storePassword: ' end ' };
  localCredentials(credentials);
  writeFileSync(gradlePath, 'android {}\n');
  const propertiesPath = join(androidRoot, 'keystore.properties');
  writeFileSync(propertiesPath, 'old=secret\n');
  chmodSync(propertiesPath, 0o666);
  configureAndroidSigning({ root, env: {} });
  const lines = readFileSync(propertiesPath, 'utf8').split('\n');
  for (const [key, value] of Object.entries(credentials)) {
    const encoded = lines.find((line) => line.startsWith(`${key}=`)).slice(key.length + 1);
    assert.equal(decodeProperty(encoded), value);
  }
  if (process.platform !== 'win32') assert.equal(statSync(propertiesPath).mode & 0o777, 0o600);
});

test('incomplete or reversed Gradle markers fail before changing project or credentials files', (t) => {
  const { root, gradlePath, androidRoot, localCredentials } = fixture(t);
  localCredentials();
  for (const source of [
    'android {}\n// BEGIN TEMPLATE ANDROID SIGNING\n',
    'android {}\n// END TEMPLATE ANDROID SIGNING\n',
    '// END TEMPLATE ANDROID SIGNING\n// BEGIN TEMPLATE ANDROID SIGNING\n',
  ]) {
    writeFileSync(gradlePath, source);
    assert.throws(() => configureAndroidSigning({ root, env: {} }), /markers are incomplete/);
    assert.equal(readFileSync(gradlePath, 'utf8'), source);
    assert.ok(!existsSync(join(androidRoot, 'keystore.properties')));
  }
});
