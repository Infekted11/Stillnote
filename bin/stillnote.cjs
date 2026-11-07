#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const appPath = path.resolve(__dirname, '..');
const electronPath = require('electron');
const env = { ...process.env, STILLNOTE_USE_DIST: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [appPath, ...process.argv.slice(2)], {
  cwd: appPath,
  env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Could not launch Stillnote: ${error.message}`);
  process.exitCode = 1;
});

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
