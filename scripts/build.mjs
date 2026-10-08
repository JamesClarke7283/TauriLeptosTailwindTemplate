import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function runCommand(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.signal ?? result.status}).`);
  }
}

export function beforeBuild({
  env = process.env,
  host = process.platform,
  run = runCommand,
  exists = existsSync,
  log = console.log,
} = {}) {
  const mobile = ['android', 'ios'].includes(env.TAURI_ENV_PLATFORM);
  const debug = env.TAURI_ENV_DEBUG === 'true';

  // Nested mobile builds reuse the frontend just built by their desktop parent.
  if (!mobile || env.TAURI_TEMPLATE_FRONTEND_READY !== '1') {
    run('trunk', debug ? ['build'] : ['build', '--release'], env);
  }
  if (mobile || ['false', '0'].includes(env.TAURI_BUILD_MOBILE)) return;

  const childEnv = { ...env, TAURI_TEMPLATE_FRONTEND_READY: '1' };
  // A desktop --config override must not leak into another platform's build.
  delete childEnv.TAURI_CONFIG;

  function tauri(args) {
    // Use npm so generated native projects get working `npm run tauri` callbacks,
    // including when the parent command was `cargo tauri build`.
    const npmArgs = ['run', 'tauri', '--', ...args];
    if (host === 'win32') {
      // npm.cmd needs cmd.exe on Windows. Every argument here is a fixed token.
      run(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd ${npmArgs.join(' ')}`], childEnv);
    } else {
      run('npm', npmArgs, childEnv);
    }
  }

  function buildMobile(platform, target, marker, bundleArgs) {
    log(`Building ${platform === 'android' ? 'Android APK/AAB' : 'iOS IPA'} (ARM64)...`);
    run('rustup', ['target', 'add', target], childEnv);
    if (!exists(resolve(projectRoot, marker))) {
      tauri([platform, 'init', '--ci', '--skip-targets-install']);
    }
    tauri([
      platform, 'build', '--ci', '--target', 'aarch64', ...bundleArgs,
      ...(debug ? ['--debug'] : []),
    ]);
  }

  buildMobile('android', 'aarch64-linux-android', 'src-tauri/gen/android/gradlew', ['--apk', '--aab']);
  if (host === 'darwin') {
    buildMobile('ios', 'aarch64-apple-ios', 'src-tauri/gen/apple/project.yml', ['--no-sign']);
  } else {
    log('iOS IPA requires macOS and Xcode. Use this command on macOS or the GitHub iOS build job.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    beforeBuild();
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
