import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  nflPortfolioValidationSnapshotSchema,
  validateNflPortfolio,
} from "../server/nfl-portfolio-validation";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing required ${name} PATH`);
  return value;
}

export function disableCliNetwork(): void {
  globalThis.fetch = async () => { throw new Error("Network access is disabled during historical replay."); };
}

export async function main(): Promise<void> {
  const input = resolve(argument("--input"));
  const output = resolve(argument("--output"));
  const parsed = JSON.parse(await readFile(input, "utf8"));
  const snapshot = nflPortfolioValidationSnapshotSchema.parse(parsed.snapshot ?? parsed);
  const count = parsed.count ?? 100;
  const sourceFiles = {
    validationHarness: "server/nfl-portfolio-validation.ts",
    portfolioEngine: "server/nfl-portfolio.ts",
    solver: "server/routes.ts",
    sharedContract: "shared/nfl-portfolio.ts",
  };
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const sourceFingerprints = Object.fromEntries(await Promise.all(
    Object.entries(sourceFiles).map(async ([name, path]) => [
      name,
      `sha256:${createHash("sha256").update(await readFile(resolve(projectRoot, path))).digest("hex")}`,
    ]),
  ));
  // Replay is deliberately offline. Any accidental current-API access fails loudly.
  disableCliNetwork();
  const { solveLineup } = await import("../server/routes");
  const report = await validateNflPortfolio({ snapshot, count, solve: solveLineup, sourceFingerprints });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}