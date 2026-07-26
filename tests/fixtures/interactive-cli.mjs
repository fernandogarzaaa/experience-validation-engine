process.stdout.write("part");
setTimeout(() => process.stdout.write("ial line\n"), 20);
setTimeout(() => {
  process.stdout.write("Waiting for input: ");
  // Never exits on its own — simulates an interactive prompt.
}, 40);
