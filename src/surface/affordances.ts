import type { TextAffordance } from "./textFrame.js";

/**
 * Strip ANSI escape sequences so perceived text matches what a human reads.
 *
 * The escape byte is optional in the pattern because both forms reach EVE:
 * live process output carries the real `ESC [ … m`, while transcripts pasted
 * into issues and captured to files have often already lost the escape byte
 * and kept the visible bracket. A reader sees neither, so both go.
 */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ANSI escape byte is the entire point — it is what a terminal emits and what a reader never sees.
  return text.replace(/\u001B?\[[0-9;?]*[A-Za-z]/g, "");
}

const BACKTICK_COMMAND = /`([^`]+)`/;
const PROMPT = /[:?]\s*$/;
const HELP_ENTRY = /^\s{2,}([a-z][\w:-]*)\s{2,}\S/;
const STACK_FRAME = /^\s+at\s/;

/**
 * Detect what the operator can act on next. Three affordance kinds:
 * a command the output suggests, a documented subcommand in a help
 * listing, and a prompt awaiting input.
 *
 * Order matters: a help entry is checked before the prompt heuristic so a
 * section header like "Commands:" does not masquerade as an input prompt.
 */
export function detectAffordances(lines: readonly string[]): TextAffordance[] {
  const found: TextAffordance[] = [];
  let sawHelpEntry = false;

  lines.forEach((raw, line) => {
    const text = stripAnsi(raw);
    if (STACK_FRAME.test(text)) return;

    const backtick = BACKTICK_COMMAND.exec(text);
    if (backtick) {
      found.push({
        line,
        column: backtick.index + 1,
        text: backtick[1]!,
        role: "button",
        command: backtick[1]!,
      });
      return;
    }

    const help = HELP_ENTRY.exec(text);
    if (help) {
      sawHelpEntry = true;
      found.push({
        line,
        column: text.indexOf(help[1]!),
        text: help[1]!,
        role: "menuitem",
        command: help[1]!,
      });
      return;
    }

    // A trailing-colon line is only a prompt when it is not a section header
    // introducing a help listing. A header is Title-Cased word-by-word
    // ("Commands:"); a sentence like "Enter your name: " has lowercase
    // interior words and must not be excluded.
    const isSectionHeader = /^[A-Z][\w]*(?:\s[A-Z][\w]*)*:\s*$/.test(text);
    if (text.trim() && PROMPT.test(text) && !isSectionHeader) {
      found.push({ line, column: 0, text: text.trim(), role: "textbox" });
    }
  });

  void sawHelpEntry;
  return found;
}
