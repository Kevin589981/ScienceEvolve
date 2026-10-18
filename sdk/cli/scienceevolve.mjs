#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { mainHelp, runMainCli } from "./main-cli.mjs";

function parseArguments(argv) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const name = equals < 0 ? argument.slice(2) : argument.slice(2, equals);
    if (!/^[a-z][a-z0-9-]*$/.test(name) || options.has(name)) throw new Error(`Invalid or repeated option --${name}`);
    if (name === "help") {
      options.set(name, true);
      continue;
    }
    const value = equals < 0 ? argv[++index] : argument.slice(equals + 1);
    if (!value || value.startsWith("--")) throw new Error(`Option --${name} requires a value`);
    options.set(name, value);
  }
  return { positionals, options };
}


try {
  const { positionals, options } = parseArguments(process.argv.slice(2));
  if (options.has("engine") && options.get("engine") !== "main") {
    throw new Error("Only the main engine is supported; the legacy engine has been removed");
  }
  if (options.has("help") || positionals.length === 0 || positionals[0] === "help") process.stdout.write(mainHelp + "\n");
  else if (positionals[0] === "version") {
    if (positionals.length !== 1) throw new Error("Expected 1 positional argument");
    const info = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    process.stdout.write(info.version + "\n");
  } else process.exitCode = await runMainCli(positionals, options);
} catch (error) {
  process.stderr.write(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exitCode = 1;
}
