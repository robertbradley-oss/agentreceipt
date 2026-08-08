import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { executeCli } from "../dist/src/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  await execFileAsync("git", args, { cwd, windowsHide: true });
}

test("runback request loading is bounded and preflight executes nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-runback-request-"));
  const repository = join(root, "repository");
  const request = {
    schemaVersion: 1,
    intent: {
      id: "read-project",
      needs: [{
        id: "orient",
        function: "observe",
        capability: "map_project",
        inputs: ["workspace"],
        outputs: ["project_map"],
        requiredScopes: ["repository:read"],
        maxRisk: "read",
      }],
    },
    initialArtifacts: ["workspace"],
    allowedScopes: ["repository:read"],
  };

  try {
    await mkdir(repository);
    await git(repository, ["init"]);
    await git(repository, ["config", "user.email", "agentreceipt@example.invalid"]);
    await git(repository, ["config", "user.name", "AgentReceipt Test"]);
    await writeFile(join(repository, ".gitignore"), ".agentreceipt/\n", "utf8");
    await writeFile(join(repository, "request.json"), `${JSON.stringify(request, null, 2)}\n`, "utf8");
    await git(repository, ["add", ".gitignore", "request.json"]);
    await git(repository, ["commit", "-m", "fixture"]);

    const output = await executeCli(["runback", "request.json"], { cwd: repository });
    assert.match(output, /Runback preflight: uncovered/);
    assert.match(output, /Local component releases: 0/);
    assert.match(output, /No tools were executed/);

    const nested = join(repository, "nested");
    await mkdir(nested);
    const nestedOutput = await executeCli(["runback", "request.json"], { cwd: nested });
    assert.match(nestedOutput, /Local component releases: 0/);

    await assert.rejects(
      executeCli(["runback", ".git/config"], { cwd: repository }),
      /path is unsafe/i,
    );

    await writeFile(join(repository, "invalid.json"), `${JSON.stringify({ ...request, unexpected: "private" })}\n`, "utf8");
    await assert.rejects(
      executeCli(["runback", "invalid.json"], { cwd: repository }),
      /request is invalid/i,
    );

    await link(join(repository, "request.json"), join(repository, "linked-request.json"));
    await assert.rejects(
      executeCli(["runback", "linked-request.json"], { cwd: repository }),
      /path is unsafe/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
