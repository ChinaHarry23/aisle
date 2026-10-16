/**
 * Account maintenance.
 *
 *   npm run user -- list
 *   npm run user -- password someone@example.com
 *   npm run user -- add "Name" someone@example.com
 *   npm run user -- reset-passwords          # every seeded desk, new password
 *   npm run user -- credits someone@example.com        # balance and recent ledger
 *   npm run user -- credits someone@example.com 250    # add (or, negative, remove) credits
 *
 * Runs directly against the same database the app uses, through the same code
 * path, so it can never drift from what the web app sees.
 */

import { createInterface } from "node:readline/promises";
// The app's modules import each other as "@/…"; register the resolver before loading them.
import "./service-loader.mjs";

const { closeDatabase, databaseLabel, getDatabase } = await import("../src/lib/db/index");
const { countUsers, ensureSeedAccounts, findUserByEmail, listUsers, setPassword, createUser } = await import(
  "../src/lib/auth/users"
);
const { SEED_ACCOUNTS, seedPassword } = await import("../src/lib/auth/seed-accounts");
const { adjustCredits, balanceMilli, recentLedger } = await import("../src/lib/billing/ledger");
const { billingFor, isUnlimited } = await import("../src/lib/billing/meter");
const { formatCredits, MILLI } = await import("../src/lib/billing/plan");

async function promptPassword(label: string, fallback?: string): Promise<string> {
  if (!process.stdin.isTTY) return fallback ?? seedPassword() ?? randomPassword();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${label} [${fallback ?? "random"}]: `)).trim();
  rl.close();
  return answer || fallback || randomPassword();
}

function randomPassword() {
  return `aisle-${Math.random().toString(36).slice(2, 10)}`;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const db = await getDatabase();
  console.log(`database: ${db.label}`);

  switch (command) {
    case "list": {
      const users = await listUsers();
      if (users.length === 0) {
        console.log("no accounts yet — open /signup, or run: npm run user -- add");
        break;
      }
      for (const u of users) console.log(`  ${u.role.padEnd(5)} ${u.email.padEnd(28)} ${u.name}`);
      console.log(`\n${users.length} account(s).`);
      break;
    }

    case "password": {
      const email = rest[0];
      if (!email) {
        console.error("usage: npm run user -- password <email>");
        process.exitCode = 1;
        break;
      }
      const password = await promptPassword(`New password for ${email}`);
      const ok = await setPassword(email, password);
      console.log(ok ? `updated ${email} → ${password}` : `no account for ${email}`);
      if (!ok) process.exitCode = 1;
      break;
    }

    case "add": {
      const [name, email] = rest;
      if (!name || !email) {
        console.error('usage: npm run user -- add "Full Name" someone@example.com');
        process.exitCode = 1;
        break;
      }
      const password = await promptPassword(`Password for ${email}`);
      const user = await createUser({ name, email, password, role: "dev" });
      console.log(`created ${user.email} (${user.role}) with password ${password}`);
      break;
    }

    case "reset-passwords": {
      const password = seedPassword();
      if (!password) {
        console.error("This is a hosted install: set AISLE_SEED_PASSWORD first (the demo password is local-only).");
        process.exitCode = 1;
        break;
      }
      const seeded = await ensureSeedAccounts();
      for (const account of SEED_ACCOUNTS) {
        await setPassword(account.email, password);
      }
      console.log(`set every seeded desk to "${password}"${seeded.seeded ? " (accounts were just created)" : ""}`);
      break;
    }

    case "credits": {
      const [email, amount] = rest;
      if (!email) {
        console.error("usage: npm run user -- credits <email> [delta]");
        process.exitCode = 1;
        break;
      }
      const user = await findUserByEmail(email);
      if (!user) {
        console.error(`no account for ${email}`);
        process.exitCode = 1;
        break;
      }
      if (amount !== undefined) {
        const delta = Number(amount);
        if (!Number.isFinite(delta) || delta === 0) {
          console.error("delta must be a non-zero number of credits, e.g. 250 or -100");
          process.exitCode = 1;
          break;
        }
        const after = await adjustCredits(user.id, Math.round(delta * MILLI), `Owner adjustment (${delta > 0 ? "+" : ""}${delta})`);
        console.log(`${user.email}: ${delta > 0 ? "+" : ""}${delta} credits → ${formatCredits(after)}`);
        break;
      }
      const balance = await balanceMilli(user.id);
      console.log(`${user.email} (${user.role}, id ${user.id}): ${isUnlimited(billingFor(user)) ? "unlimited" : `${formatCredits(balance)} credits`}`);
      for (const entry of await recentLedger(user.id, 10)) {
        const delta = entry.deltaMilli === 0 ? "0" : `${entry.deltaMilli > 0 ? "+" : "-"}${formatCredits(Math.abs(entry.deltaMilli))}`;
        console.log(`  ${entry.createdAt.slice(0, 16).replace("T", " ")}  ${entry.reason.padEnd(13)} ${delta.padStart(8)}  ${entry.note ?? entry.modelId ?? ""}`);
      }
      break;
    }

    default: {
      const seeded = await ensureSeedAccounts();
      const total = await countUsers();
      console.log(`configured backend: ${databaseLabel()}`);
      console.log(`accounts: ${total}${seeded.seeded ? ` (seeded ${SEED_ACCOUNTS.length} team desks)` : ""}`);
      const password = seedPassword();
      console.log(
        password
          ? `seeded desks sign in with: ${password}`
          : "no seeded desks: this is a hosted install and AISLE_SEED_PASSWORD is not set",
      );
      console.log(`
commands:
  list                       show accounts
  add "Name" <email>         create an account
  password <email>           set a new password
  reset-passwords            set the seeded desks to AISLE_SEED_PASSWORD (locally, the demo default)
  credits <email> [delta]    show a balance, or add/remove credits
`);
    }
  }

  await closeDatabase();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDatabase();
  process.exitCode = 1;
});
