#!/usr/bin/env node
// Runs the team's private hudle command when this machine can get it, and
// otherwise runs the given command as it is.
//
//   hudle run [--env <name>] -- <command...>
//   hudle <anything else>          passed through; needs the private command
//
// In CI (CI or NETLIFY set) the command always runs as it is.
// HUDLE_CLI=<path to bin/hudle.mjs> uses a local copy instead.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "Woolly-Mammoth/hudle-cli";
const SOURCES = [`https://github.com/${REPO}.git`, `git@github.com:${REPO}.git`];
const CACHE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "hudle-run");
const CHECKOUT = join(CACHE, "cli");
const ENTRY = join(CHECKOUT, "bin", "hudle.mjs");
const NO_ACCESS = join(CACHE, "no-access");
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 60 * 1000;

const args = process.argv.slice(2);
const say = (message) => process.stderr.write(`hudle: ${message}\n`);

// Never asks for a password or a host key: either access is already set up, or it isn't.
const git = (gitArgs, timeout = 30_000) =>
  spawnSync("git", gitArgs, {
    stdio: "ignore",
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10" },
  }).status === 0;

const age = (file) => (existsSync(file) ? Date.now() - statSync(file).mtimeMs : Infinity);

function fetchCli() {
  if (process.env.HUDLE_CLI) return existsSync(process.env.HUDLE_CLI) ? process.env.HUDLE_CLI : null;
  mkdirSync(CACHE, { recursive: true });
  if (existsSync(ENTRY)) {
    const stamp = join(CACHE, "updated");
    if (age(stamp) > UPDATE_EVERY_MS) {
      // Best effort: a failed update keeps the copy there is.
      if (git(["-C", CHECKOUT, "pull", "--ff-only", "--quiet"], 15_000)) writeFileSync(stamp, "");
    }
    return ENTRY;
  }
  if (age(NO_ACCESS) < RETRY_AFTER_MS && !process.env.HUDLE_RETRY) return null;
  for (const source of SOURCES) {
    rmSync(CHECKOUT, { recursive: true, force: true });
    if (git(["clone", "--quiet", "--depth", "1", source, CHECKOUT]) && existsSync(ENTRY)) {
      rmSync(NO_ACCESS, { force: true });
      writeFileSync(join(CACHE, "updated"), "");
      return ENTRY;
    }
  }
  rmSync(CHECKOUT, { recursive: true, force: true });
  writeFileSync(NO_ACCESS, "");
  return null;
}

function start(command, commandArgs, env = process.env) {
  const child = spawn(command, commandArgs, { stdio: "inherit", env });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)));
  child.on("error", (err) => {
    say(`couldn't start ${command}: ${err.message}`);
    process.exit(1);
  });
}

/** The command in `hudle run [--env <name>] [--] <command...>`, read the way the hudle command reads it. */
function commandOf(runArgs) {
  const rest = [...runArgs];
  while (rest.length && rest[0] !== "--") {
    if (rest[0] === "--env" || rest[0] === "-e") rest.splice(0, 2);
    else if (rest[0].startsWith("--env=")) rest.shift();
    else break;
  }
  return rest[0] === "--" ? rest.slice(1) : rest;
}

function runAsIs(reason) {
  const command = commandOf(args.slice(1));
  if (command.length === 0) {
    say("say what to run: hudle run -- next dev");
    process.exit(1);
  }
  if (reason) say(reason);
  start(command[0], command.slice(1));
}

const ci = Boolean(process.env.CI || process.env.NETLIFY);
if (args[0] === "run" && ci) {
  runAsIs(null);
} else {
  const cli = fetchCli();
  if (cli) start(process.execPath, [cli, ...args]);
  else if (args[0] === "run") runAsIs(`couldn't get the hudle command (no access to ${REPO} from this machine), so running without it. HUDLE_RETRY=1 tries again now.`);
  else {
    say(`this needs the hudle command, and this machine has no access to ${REPO}.`);
    process.exit(1);
  }
}
