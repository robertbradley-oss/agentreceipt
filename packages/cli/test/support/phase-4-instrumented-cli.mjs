import { CliError, executeCli } from "../../dist/src/index.js";

const argumentsList = process.argv.slice(2);
if (argumentsList.length === 1 && argumentsList[0] === "--self-test-safe-diagnostic-ipc") {
  if (typeof process.send === "function") {
    process.send({
      kind: "safe_capture_diagnostic",
      classification: "allowlisted_command_embedded",
    });
  }
  process.stderr.write(
    "AgentReceipt error: Observe, learn, or replay input failed safely (capsule_ineligible).\n",
  );
  process.exitCode = 1;
} else {
  try {
    const output = await executeCli(argumentsList, {
      onSafeCaptureDiagnostic: (classification) => {
        if (typeof process.send === "function") {
          process.send({ kind: "safe_capture_diagnostic", classification });
        }
      },
    });
    process.stdout.write(output);
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`AgentReceipt error: ${error.message}\n`);
      process.exitCode = error.exitCode;
    } else {
      process.stderr.write("AgentReceipt error: Instrumented CLI failed safely.\n");
      process.exitCode = 1;
    }
  }
}
