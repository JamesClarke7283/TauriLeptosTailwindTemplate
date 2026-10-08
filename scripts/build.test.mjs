import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { beforeBuild } from './build.mjs';

function capture(options = {}) {
  const commands = [];
  const messages = [];
  beforeBuild({
    env: { TAURI_ENV_PLATFORM: 'linux' },
    host: 'linux',
    exists: () => true,
    run: (command, args, env) => commands.push({ command, args, env }),
    log: (message) => messages.push(message),
    configureAndroid: () => {},
    ...options,
  });
  return { commands, messages };
}

function mobileBuilds(commands) {
  return commands.filter(({ command, args }) => command === 'npm' && args[4] === 'build');
}

test('a Linux desktop build creates Android packages and explains how to get iOS', () => {
  const { commands, messages } = capture();
  assert.equal(commands[0].command, 'trunk');
  assert.deepEqual(commands[0].args, ['build', '--release']);
  assert.deepEqual(mobileBuilds(commands).map(({ args }) => args.slice(3)), [
    ['android', 'build', '--ci', '--target', 'aarch64', '--apk', '--aab'],
  ]);
  assert.ok(messages.some((message) => /iOS IPA requires macOS and Xcode/.test(message)));
  assert.ok(!commands.some(({ args }) => args.includes('aarch64-apple-ios')));
});

test('macOS builds both Android packages and an unsigned iOS IPA', () => {
  const { commands, messages } = capture({
    host: 'darwin',
    env: { TAURI_ENV_PLATFORM: 'darwin' },
  });
  assert.deepEqual(mobileBuilds(commands).map(({ args }) => args.slice(3)), [
    ['android', 'build', '--ci', '--target', 'aarch64', '--apk', '--aab'],
    ['ios', 'build', '--ci', '--target', 'aarch64', '--no-sign'],
  ]);
  assert.ok(!messages.some((message) => message.includes('requires macOS')));
});

test('direct mobile commands build the frontend without launching more native builds', () => {
  for (const platform of ['android', 'ios']) {
    const { commands } = capture({
      host: 'darwin',
      env: { TAURI_ENV_PLATFORM: platform },
    });
    assert.deepEqual(commands.map(({ command, args }) => [command, args]), [
      ['trunk', ['build', '--release']],
    ]);
  }
});

test('nested mobile hooks reuse one frontend build and do not recurse', () => {
  const commands = [];
  const run = (command, args, env) => {
    commands.push({ command, args, env });
    if (command === 'npm' && args[4] === 'build') {
      beforeBuild({
        host: 'darwin',
        env: { ...env, TAURI_ENV_PLATFORM: args[3] },
        run,
        exists: () => true,
        log: () => {},
        configureAndroid: () => {},
      });
    }
  };
  beforeBuild({
    host: 'darwin',
    env: { TAURI_ENV_PLATFORM: 'darwin' },
    run,
    exists: () => true,
    log: () => {},
  });
  assert.equal(commands.filter(({ command }) => command === 'trunk').length, 1);
  assert.equal(mobileBuilds(commands).length, 2);
});

test('frontend-ready only skips the frontend inside a mobile hook', () => {
  for (const platform of ['android', 'ios']) {
    const { commands } = capture({
      env: { TAURI_ENV_PLATFORM: platform, TAURI_TEMPLATE_FRONTEND_READY: '1' },
    });
    assert.deepEqual(commands, []);
  }
  const { commands } = capture({
    env: { TAURI_ENV_PLATFORM: 'linux', TAURI_TEMPLATE_FRONTEND_READY: '1' },
  });
  assert.equal(commands[0].command, 'trunk');
});

test('desktop-only opt-out still builds the frontend', () => {
  for (const value of ['false', '0']) {
    const { commands } = capture({
      host: 'darwin',
      env: { TAURI_ENV_PLATFORM: 'darwin', TAURI_BUILD_MOBILE: value },
    });
    assert.deepEqual(commands.map(({ command }) => command), ['trunk']);
  }
});

test('debug builds use the same profile for frontend and both mobile packages', () => {
  const { commands } = capture({
    host: 'darwin',
    env: { TAURI_ENV_PLATFORM: 'darwin', TAURI_ENV_DEBUG: 'true' },
  });
  assert.deepEqual(commands[0].args, ['build']);
  assert.equal(mobileBuilds(commands).length, 2);
  for (const { args } of mobileBuilds(commands)) {
    assert.ok(args.includes('--debug'));
  }
});

test('fresh native projects initialize before their own build', () => {
  const checkedPaths = [];
  const { commands } = capture({
    host: 'darwin',
    env: { TAURI_ENV_PLATFORM: 'darwin' },
    exists: (path) => { checkedPaths.push(path); return false; },
  });
  assert.ok(checkedPaths.some((path) => path.endsWith(join('src-tauri', 'gen', 'android', 'gradlew'))));
  assert.ok(checkedPaths.some((path) => path.endsWith(join('src-tauri', 'gen', 'apple', 'project.yml'))));
  assert.deepEqual(commands.filter(({ command }) => command === 'npm').map(({ args }) => args.slice(3, 5)), [
    ['android', 'init'],
    ['android', 'build'],
    ['ios', 'init'],
    ['ios', 'build'],
  ]);
  for (const { args } of commands.filter(({ command, args }) => command === 'npm' && args[4] === 'init')) {
    assert.ok(args.includes('--ci'));
    assert.ok(args.includes('--skip-targets-install'));
  }
});

test('existing native projects are preserved and only missing projects initialize', () => {
  const { commands } = capture({
    host: 'darwin',
    env: { TAURI_ENV_PLATFORM: 'darwin' },
    exists: (path) => path.endsWith(join('src-tauri', 'gen', 'android', 'gradlew')),
  });
  const initializations = commands.filter(({ command, args }) => command === 'npm' && args[4] === 'init');
  assert.deepEqual(initializations.map(({ args }) => args[3]), ['ios']);
  assert.equal(mobileBuilds(commands).length, 2);
});

test('Windows invokes npm.cmd through the configured command interpreter', () => {
  for (const comspec of [undefined, 'C:\\Windows\\System32\\cmd.exe']) {
    const { commands, messages } = capture({
      host: 'win32',
      env: { TAURI_ENV_PLATFORM: 'windows', ...(comspec ? { ComSpec: comspec } : {}) },
      exists: () => false,
    });
    const nativeCommands = commands.filter(({ command }) => command === (comspec || 'cmd.exe'));
    assert.deepEqual(nativeCommands.map(({ args }) => args), [
      ['/d', '/s', '/c', 'npm.cmd run tauri -- android init --ci --skip-targets-install'],
      ['/d', '/s', '/c', 'npm.cmd run tauri -- android build --ci --target aarch64 --apk --aab'],
    ]);
    assert.ok(messages.some((message) => message.includes('requires macOS')));
  }
});

test('desktop configuration stays with the parent and is removed from mobile children', () => {
  const env = {
    TAURI_ENV_PLATFORM: 'darwin',
    TAURI_CONFIG: '{"bundle":{"targets":["dmg"]}}',
    JAVA_HOME: '/android/java',
    PATH: '/tools',
  };
  const original = { ...env };
  const { commands } = capture({ host: 'darwin', env, exists: () => false });
  assert.equal(commands[0].env.TAURI_CONFIG, env.TAURI_CONFIG);
  for (const { env: childEnv } of commands.slice(1)) {
    assert.ok(!Object.hasOwn(childEnv, 'TAURI_CONFIG'));
    assert.equal(childEnv.TAURI_TEMPLATE_FRONTEND_READY, '1');
    assert.equal(childEnv.JAVA_HOME, env.JAVA_HOME);
    assert.equal(childEnv.PATH, env.PATH);
  }
  assert.deepEqual(env, original);
});

test('a failed command stops the build and preserves its original failure', () => {
  for (const failAt of ['frontend', 'toolchain', 'init', 'android-build']) {
    const commands = [];
    const failure = new Error(`failed ${failAt}`);
    assert.throws(() => beforeBuild({
      host: 'darwin',
      env: { TAURI_ENV_PLATFORM: 'darwin' },
      exists: () => false,
      log: () => {},
      run: (command, args) => {
        commands.push({ command, args });
        if (
          (failAt === 'frontend' && command === 'trunk') ||
          (failAt === 'toolchain' && command === 'rustup') ||
          (failAt === 'init' && command === 'npm' && args[4] === 'init') ||
          (failAt === 'android-build' && command === 'npm' && args[4] === 'build')
        ) throw failure;
      },
    }), (error) => error === failure);
    assert.ok(!commands.some(({ args }) => args.includes('ios') || args.includes('aarch64-apple-ios')));
    assert.equal(commands.length, { frontend: 1, toolchain: 2, init: 3, 'android-build': 4 }[failAt]);
  }
});

test('a direct Android release hook configures signing before building its frontend', () => {
  const env = { TAURI_ENV_PLATFORM: 'android', ANDROID_KEY_ALIAS: 'release' };
  const events = [];
  capture({
    env,
    configureAndroid: (options) => {
      assert.equal(options.env, env);
      events.push('signing');
    },
    run: (command) => events.push(command),
  });
  assert.deepEqual(events, ['signing', 'trunk']);
});

test('nested Android release hooks configure signing even when the frontend is already built', () => {
  const events = [];
  capture({
    env: { TAURI_ENV_PLATFORM: 'android', TAURI_TEMPLATE_FRONTEND_READY: '1' },
    configureAndroid: () => events.push('signing'),
    run: (command) => events.push(command),
  });
  assert.deepEqual(events, ['signing']);
});

test('Android debug and iOS hooks do not configure Android release signing', () => {
  for (const env of [
    { TAURI_ENV_PLATFORM: 'android', TAURI_ENV_DEBUG: 'true' },
    { TAURI_ENV_PLATFORM: 'ios' },
  ]) {
    const { commands } = capture({
      env,
      configureAndroid: () => assert.fail('release signing must not run'),
    });
    assert.deepEqual(commands.map(({ command }) => command), ['trunk']);
  }
});

test('an Android signing failure stops the hook before the frontend and preserves its error', () => {
  const commands = [];
  const failure = new Error('no persistent Android signing key');
  assert.throws(() => capture({
    env: { TAURI_ENV_PLATFORM: 'android' },
    configureAndroid: () => { throw failure; },
    run: (command) => commands.push(command),
  }), (error) => error === failure);
  assert.deepEqual(commands, []);
});
