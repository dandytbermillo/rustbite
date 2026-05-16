/* eslint-disable no-console */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const cwd = resolve(process.cwd());
const packageJsonPath = join(cwd, "package.json");
const nextDir = join(cwd, ".next");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(packageJsonPath)) {
  fail("Refusing to clean .next: package.json was not found in the current directory.");
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (packageJson.name !== "rushbite-kiosk") {
  fail(
    `Refusing to clean .next: expected package name rushbite-kiosk, found ${packageJson.name ?? "unknown"}.`
  );
}

if (!existsSync(nextDir)) {
  console.log(".next does not exist; nothing to clean.");
  process.exit(0);
}

rmSync(nextDir, { recursive: true, force: true });
console.log(`Removed ${nextDir}`);
