/**
 * Applies a migration file over the Supabase IPv4 connection pooler.
 *
 * The direct host (`db.<ref>.supabase.co`) is IPv6-only and unreachable from
 * some networks, so this walks the Supavisor pooler regions until one accepts
 * the project credentials.
 *
 *   npx tsx --env-file=.env.local scripts/run-migration.ts supabase/migrations/0002_event_types.sql
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const REGIONS = [
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
];
const PREFIXES = ["aws-0", "aws-1"];

function projectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match) throw new Error(`Cannot read project ref from ${url}`);
  return match[1];
}

async function connect(): Promise<Client> {
  const ref = projectRef();
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) throw new Error("Missing SUPABASE_DB_PASSWORD");

  const attempts: string[] = [];
  for (const prefix of PREFIXES) {
    for (const region of REGIONS) {
      const host = `${prefix}-${region}.pooler.supabase.com`;
      const client = new Client({
        host,
        port: 5432, // session mode — transaction mode (6543) rejects some DDL
        user: `postgres.${ref}`,
        password,
        database: "postgres",
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 8000,
      });
      try {
        await client.connect();
        console.log(`Connected via ${host}`);
        return client;
      } catch (error) {
        attempts.push(`${host}: ${(error as Error).message}`);
        await client.end().catch(() => {});
      }
    }
  }
  throw new Error(`Could not connect to any pooler region:\n  ${attempts.join("\n  ")}`);
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: run-migration.ts <path-to-sql>");
  const sql = readFileSync(file, "utf8");

  const client = await connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log(`Applied ${file}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
