#!/usr/bin/env node
import { run } from './cli.js';

try {
  process.exitCode = await run(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    cwd: process.cwd(),
  });
} catch (error) {
  // Expected failures (a missing player, an unreadable folder) read as one line.
  process.stderr.write(`freequest: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
