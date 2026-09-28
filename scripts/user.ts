/**
 * Account maintenance.
 *
 *   npm run user -- list
 *   npm run user -- password someone@example.com
 *   npm run user -- add "Name" someone@example.com
 *   npm run user -- reset-passwords          # every seeded desk, new password
 *
 * Runs directly against the same database the app uses, through the same code
 * path, so it can never drift from what the web app sees.
 */

import { createInterface } from "node:readline/promises";
import { closeDatabase, databaseLabel, getDatabase } from "../src/lib/db/index";
import {
  countUsers,
  ensureSeedAccounts,
  listUsers,
  setPassword,
  createUser,
} from "../src/lib/auth/users";
import { SEED_ACCOUNTS, SEED_PASSWORD } from "../src/lib/auth/seed-accounts";

async function promptPassword(label: string, fallback?: string): Promise<string> {
  if (!process.stdin.isTTY) return fallback ?? SEED_PASSWORD;
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
      const seeded = await ensureSeedAccounts();
      for (const account of SEED_ACCOUNTS) {
        await setPassword(account.email, SEED_PASSWORD);
      }
      console.log(
        `set every seeded desk to "${SEED_PASSWORD}"${seeded.seeded ? " (accounts were just created)" : ""}`,
      );
      break;
    }

    default: {
      const seeded = await ensureSeedAccounts();
      const total = await countUsers();
      console.log(`configured backend: ${databaseLabel()}`);
      console.log(`accounts: ${total}${seeded.seeded ? ` (seeded ${SEED_ACCOUNTS.length} team desks)` : ""}`);
      console.log(`seeded desks sign in with: ${SEED_PASSWORD}`);
      console.log(`
commands:
  list                       show accounts
  add "Name" <email>         create an account
  password <email>           set a new password
  reset-passwords            restore the seeded desks to the default password
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
