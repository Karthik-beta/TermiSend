import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repoRoot = resolve(scriptDir, '..');

const defaultName = 'TermiSend';
const defaultIconPath = resolve(repoRoot, 'assets', 'termisend.ico');
const defaultDesktopPath = process.env.USERPROFILE
  ? resolve(process.env.USERPROFILE, 'Desktop')
  : resolve(os.homedir(), 'Desktop');
const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
const cmdPath = join(systemRoot, 'System32', 'cmd.exe');

interface Options {
  name: string;
  desktopPath?: string;
  iconPath?: string;
  force: boolean;
}

function printUsage(): void {
  console.log('Usage: bun run scripts/create-windows-shortcut.ts [options]');
  console.log('Options:');
  console.log('  --name <name>           Shortcut name (appends .lnk if missing)');
  console.log('  --desktop-path <path>   Override the desktop directory');
  console.log('  --icon <path>           Custom .ico file to use');
  console.log('  --force                 Overwrite an existing shortcut');
}

if (process.platform !== 'win32') {
  console.error('This shortcut helper only runs on Windows.');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

const options: Options = { name: defaultName, force: false };

let cursor = 0;
while (cursor < args.length) {
  const arg = args[cursor++];
  switch (arg) {
    case '--name':
      if (cursor >= args.length) {
        console.error('Missing value for --name');
        printUsage();
        process.exit(1);
      }
      options.name = args[cursor++];
      break;
    case '--desktop-path':
      if (cursor >= args.length) {
        console.error('Missing value for --desktop-path');
        printUsage();
        process.exit(1);
      }
      options.desktopPath = args[cursor++];
      break;
    case '--icon':
      if (cursor >= args.length) {
        console.error('Missing value for --icon');
        printUsage();
        process.exit(1);
      }
      options.iconPath = args[cursor++];
      break;
    case '--force':
      options.force = true;
      break;
    default:
      console.error(`Unknown option: ${arg}`);
      printUsage();
      process.exit(1);
  }
}

const distPath = resolve(repoRoot, 'dist', 'index.js');
if (!existsSync(distPath)) {
  console.error('Production bundle not found. Run `bun build` before creating the shortcut.');
  process.exit(1);
}

const resolvedDesktopPath = options.desktopPath
  ? resolve(options.desktopPath)
  : defaultDesktopPath;

if (!existsSync(resolvedDesktopPath)) {
  console.error(`Desktop path does not exist: ${resolvedDesktopPath}`);
  process.exit(1);
}

const normalizedName = options.name.trim() || defaultName;
const shortcutFileName = normalizedName.toLowerCase().endsWith('.lnk')
  ? normalizedName
  : `${normalizedName}.lnk`;
const shortcutPath = resolve(resolvedDesktopPath, shortcutFileName);

if (existsSync(shortcutPath) && !options.force) {
  console.error(`Shortcut already exists at ${shortcutPath}. Use --force to replace it.`);
  process.exit(1);
}

if (existsSync(shortcutPath) && options.force) {
  unlinkSync(shortcutPath);
}

if (!existsSync(cmdPath)) {
  console.error(`Unable to find Command Prompt at ${cmdPath}.`);
  process.exit(1);
}

let iconPath: string | undefined;
if (options.iconPath) {
  const candidate = resolve(options.iconPath);
  if (!existsSync(candidate)) {
    console.warn(`Custom icon not found at ${candidate}; falling back to default icon (if available).`);
  } else {
    iconPath = candidate;
  }
}
if (!iconPath && existsSync(defaultIconPath)) {
  iconPath = defaultIconPath;
}

const bunPath = process.execPath;
const escapeShortcutValue = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const launcherPath = resolve(repoRoot, '.termisend-launch.cmd');
const launcherContents = [
  '@echo off',
  `cd /d "${repoRoot}"`,
  `"${bunPath}" "${distPath}"`,
  'set TERMISEND_EXIT_CODE=%ERRORLEVEL%',
  'echo.',
  'if not "%TERMISEND_EXIT_CODE%"=="0" echo TermiSend exited with code %TERMISEND_EXIT_CODE%.',
].join('\r\n');
writeFileSync(launcherPath, launcherContents, 'utf8');
const cmdArgs = `/k "${launcherPath.replace(/"/g, '""')}"`;

const commands = [
  '$Shell = New-Object -ComObject WScript.Shell',
  `$Shortcut = $Shell.CreateShortcut(${escapeShortcutValue(shortcutPath)})`,
  `$Shortcut.TargetPath = ${escapeShortcutValue(cmdPath)}`,
  `$Shortcut.Arguments = ${escapeShortcutValue(cmdArgs)}`,
  `$Shortcut.WorkingDirectory = ${escapeShortcutValue(repoRoot)}`,
  `$Shortcut.Description = ${escapeShortcutValue('TermiSend desktop shortcut')}`,
  `$Shortcut.Hotkey = ${escapeShortcutValue('Ctrl+Alt+T')}`,
];
if (iconPath) {
  commands.push(`$Shortcut.IconLocation = ${escapeShortcutValue(iconPath)}`);
}
commands.push('$Shortcut.Save()');

const result = spawnSync('powershell', ['-NoProfile', '-Command', commands.join('; ')], {
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error('Failed to create Windows shortcut.');
  process.exit(result.status ?? 1);
}

console.log(`Created TermiSend shortcut at ${shortcutPath}`);
