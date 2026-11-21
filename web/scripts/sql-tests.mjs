// The database tests, run on a throwaway Postgres (AUD-43). Builds a fresh database, adds a stand-in
// for the parts of Supabase the SQL uses (supabase/ci/bootstrap.sql), applies every migration in
// order, then runs each fixture in supabase/tests. Each fixture runs inside a transaction that it
// rolls back, and fails by raising an error.
//
//   node scripts/sql-tests.mjs                 every fixture
//   node scripts/sql-tests.mjs checkout ledger only these (file names without .sql)
//   PSL_TEST_REUSE=1 node scripts/sql-tests.mjs …  reuse the database built last time
//
// Connection: the usual PGHOST / PGPORT / PGUSER / PGPASSWORD; the database is PSL_TEST_DB
// (default psl_test), dropped and made again each run. Needs psql, createdb and dropdb.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../supabase/', import.meta.url).pathname;
const db = process.env.PSL_TEST_DB || 'psl_test';
const only = process.argv.slice(2);
const work = mkdtempSync(join(tmpdir(), 'psl-sql-'));

function run(command, args, input, env = process.env) {
  const result = spawnSync(command, args, { encoding: 'utf8', input, env, maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
const psql = (file, extra = [], env) =>
  run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, ...extra, '-f', file], undefined, env);
// The fixtures check results by reading the tables directly. Signed-in staff may read them only inside
// the ledger download (psl.ledger, AUD-14), so the fixtures run with it on; checkout.sql turns it off
// to check that guard.
const fixtureEnv = { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS ?? ''} -c psl.ledger=on`.trim() };
/** The first error line psql printed, with its context. */
const firstError = (out) => {
  const lines = out.split('\n');
  const at = lines.findIndex((l) => /ERROR:/.test(l));
  return (at < 0 ? lines.slice(-6) : lines.slice(at, at + 4)).join('\n');
};

// PSL_TEST_REUSE=1: keep the database already built (quicker while fixing fixtures).
if (!process.env.PSL_TEST_REUSE) {
  run('dropdb', ['--if-exists', db]);
  const made = run('createdb', [db]);
  if (!made.ok) {
    console.error(made.out);
    process.exit(1);
  }
  const boot = join(work, 'bootstrap.sql');
  const bootstrap = readFileSync(join(root, 'ci/bootstrap.sql'), 'utf8');
  writeFileSync(boot, bootstrap.replace('current_database_placeholder', db));
  const booted = psql(boot);
  if (!booted.ok) {
    console.error('Bootstrap failed:\n' + firstError(booted.out));
    process.exit(1);
  }

  // pg_cron and pg_net can't be installed here; their shells come from the bootstrap.
  const skipped = /^[ \t]*create extension if not exists (pg_cron|pg_net)\b.*$/gim;
  const migrations = readdirSync(join(root, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const name of migrations) {
    const file = join(work, name);
    const sql = readFileSync(join(root, 'migrations', name), 'utf8');
    writeFileSync(file, sql.replace(skipped, '-- (skipped in tests) $&'));
    const applied = psql(file, ['-1']);
    if (!applied.ok) {
      console.error(`Migration ${name} failed:\n${firstError(applied.out)}`);
      process.exit(1);
    }
  }
  const helped = psql(join(root, 'ci/helpers.sql'));
  if (!helped.ok) {
    console.error('Test helpers failed:\n' + firstError(helped.out));
    process.exit(1);
  }
  console.log(`Applied ${migrations.length} migrations.`);
}

const tests = readdirSync(join(root, 'tests'))
  .filter((f) => f.endsWith('.sql') && (!only.length || only.includes(f.replace(/\.sql$/, ''))))
  .sort();
let failed = 0;
for (const name of tests) {
  const result = psql(join(root, 'tests', name), [], fixtureEnv);
  if (result.ok) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}\n${firstError(result.out).replace(/^/gm, '     ')}`);
  }
}
console.log(`${tests.length - failed} of ${tests.length} database tests passed.`);
process.exit(failed ? 1 : 0);
