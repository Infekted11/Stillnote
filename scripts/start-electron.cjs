const { spawn } = require('node:child_process');

const mode = process.argv[2];
const electronPath = require('electron');
const childEnv = { ...process.env };

// Some parent tools set this flag globally, which makes Electron run as Node.
delete childEnv.ELECTRON_RUN_AS_NODE;
if (mode === 'production') childEnv.STILLNOTE_USE_DIST = '1';
else delete childEnv.STILLNOTE_USE_DIST;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: childEnv });
child.on('error', (error) => {
  console.error('Could not launch Electron:', error);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
