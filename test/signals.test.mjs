// The wrapper must end the way its command ended, so a shell or CI can tell a killed or
// interrupted run from a passing one. Runs in CI mode, where the command is started directly
// with no Hudle lookup, so these need no access to the vault.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const BIN = fileURLToPath(new URL("../bin/hudle.mjs", import.meta.url));

const run = (command) => {
  const child = spawn(process.execPath, [BIN, "run", "--", ...command], {
    env: { ...process.env, CI: "1" },
    stdio: "ignore",
  });
  const ended = once(child, "exit").then(([code, signal]) => ({ code, signal }));
  return { child, ended };
};

test("passes the command's exit code through", async () => {
  assert.deepEqual(await run(["sh", "-c", "exit 3"]).ended, { code: 3, signal: null });
  assert.deepEqual(await run(["sh", "-c", "exit 0"]).ended, { code: 0, signal: null });
});

test("ends by the same signal when the command is killed", async () => {
  const { code, signal } = await run(["sh", "-c", "kill -TERM $$"]).ended;
  assert.notEqual(code, 0, "a killed command must not look like a pass");
  assert.equal(signal, "SIGTERM");
});

test("an interrupt (Ctrl-C) ends the wrapper by SIGINT, not exit 0", async () => {
  const { child, ended } = run(["sleep", "5"]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  child.kill("SIGINT");
  const { code, signal } = await ended;
  assert.notEqual(code, 0, "an interrupted run must not look like a pass");
  assert.equal(signal, "SIGINT");
});
