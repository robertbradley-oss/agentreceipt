import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { readRepository, readRepositoryChanges, runVerification } from "../dist/src/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return stdout.trim();
}

test("Git evidence is collected independently from a clean base commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-git-test-"));
  try {
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "agentreceipt@example.invalid"]);
    await git(root, ["config", "user.name", "AgentReceipt Test"]);
    await writeFile(join(root, "README.md"), "base\n", "utf8");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-m", "base"]);

    await mkdir(join(root, ".agentreceipt"));
    await writeFile(join(root, ".agentreceipt", "latest.json"), "{}\n", "utf8");

    const before = await readRepository(root);
    assert.equal(before.isClean, true);
    assert.match(before.headSha, /^[a-f0-9]{40,64}$/);

    await writeFile(join(root, "README.md"), "changed\n", "utf8");
    await writeFile(join(root, "new-file.txt"), "new\n", "utf8");
    const changes = await readRepositoryChanges(root, before.headSha);

    assert.deepEqual(changes, [
      { path: "new-file.txt", change: "added" },
      { path: "README.md", change: "modified" },
    ]);
    assert.equal(changes.some((change) => change.path.startsWith(".agentreceipt/")), false);
    assert.equal((await readRepository(root)).isClean, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification records only timing and exit status", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-verification-test-"));
  const executable = JSON.stringify(process.execPath);
  try {
    const success = await runVerification(
      `${executable} -e "process.stdout.write('SECRET_OUTPUT'); process.exit(0)"`,
      root,
    );
    assert.equal(success.exitCode, 0);
    assert.equal(JSON.stringify(success).includes("SECRET_OUTPUT"), false);

    const failure = await runVerification(`${executable} -e "process.exit(7)"`, root);
    assert.equal(failure.exitCode, 7);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
