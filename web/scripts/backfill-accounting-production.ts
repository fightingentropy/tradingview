const TABLES = [
  "perpsBalances",
  "spotBalances",
  "orders",
  "positions",
  "trades",
  "portfolioMetrics",
  "marketPrices",
] as const;

const CONFIRMATION = "--confirm-production";
const PAGE_SIZE = 100;
const MAX_BATCHES_PER_TABLE = 10_000;

if (process.argv[2] !== CONFIRMATION || process.argv.length !== 3) {
  console.error(
    `Refusing to mutate production. Re-run with exactly ${CONFIRMATION}.`,
  );
  process.exit(2);
}

type BatchResult = {
  continueCursor: string;
  isDone: boolean;
  updated: number;
};

const totals: Record<string, { batches: number; updated: number }> = {};

for (const table of TABLES) {
  let cursor: string | null = null;
  let batches = 0;
  let updated = 0;

  while (batches < MAX_BATCHES_PER_TABLE) {
    const args = JSON.stringify({
      table,
      paginationOpts: { numItems: PAGE_SIZE, cursor },
    });
    const child = Bun.spawn(
      [
        process.execPath,
        "x",
        "convex",
        "run",
        "migrations:backfillAccountingV1",
        args,
        "--prod",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, CONVEX_NO_UPDATE_CHECK: "true" },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `Production backfill failed for ${table}: ${stderr.trim() || stdout.trim()}`,
      );
    }

    const result = JSON.parse(stdout) as BatchResult;
    if (
      typeof result.updated !== "number" ||
      typeof result.isDone !== "boolean" ||
      typeof result.continueCursor !== "string"
    ) {
      throw new Error(`Unexpected backfill response for ${table}.`);
    }

    batches += 1;
    updated += result.updated;
    if (result.isDone) break;
    if (!result.continueCursor || result.continueCursor === cursor) {
      throw new Error(`Backfill cursor did not advance for ${table}.`);
    }
    cursor = result.continueCursor;
  }

  if (batches >= MAX_BATCHES_PER_TABLE) {
    throw new Error(`Backfill exceeded the batch safety cap for ${table}.`);
  }
  totals[table] = { batches, updated };
  console.log(`${table}: batches=${batches} updated=${updated}`);
}

console.log(JSON.stringify({ status: "complete", totals }, null, 2));
