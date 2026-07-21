#!/usr/bin/env node
import { main } from "../dist/cli/main.js";

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
