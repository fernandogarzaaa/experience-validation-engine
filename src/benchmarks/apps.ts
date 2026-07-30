import type { MockAppSpec } from "../browser/mock.js";

/**
 * Benchmark applications of known UX quality.
 *
 * A measurement instrument must discriminate known cases — this is construct
 * validity. These three apps implement the *same* core task (sign up and
 * reach a dashboard) at three deliberately different quality levels. EVE
 * should score them in a strict order (excellent > average > bad); the
 * benchmark harness (`validateBenchmarks`) turns that requirement into an
 * automated check.
 */

/** EXCELLENT: clear labels, short path, feedback, escape hatches, plain copy. */
export const EXCELLENT_APP: MockAppSpec = {
  name: "Excellent UX",
  start: "home",
  screens: [
    {
      id: "home",
      title: "Clarity — write notes that stay organized",
      elements: [
        { role: "heading", text: "Write notes that stay organized" },
        { role: "text", text: "Free to start. No credit card needed. Set up in under a minute." },
        { role: "button", text: "Create your free account", goto: "signup" },
        { role: "link", text: "Log in", goto: "login" },
      ],
    },
    {
      id: "signup",
      title: "Create your account — Clarity",
      elements: [
        { role: "heading", text: "Create your account" },
        { role: "text", text: "Step 1 of 1 — this is the only step." },
        { role: "textbox", text: "Email address", editable: true },
        { role: "textbox", text: "Choose a password", editable: true },
        { role: "button", text: "Create account", goto: "welcome" },
        { role: "link", text: "Back to home", goto: "home" },
      ],
    },
    {
      id: "login",
      title: "Log in — Clarity",
      elements: [
        { role: "heading", text: "Welcome back" },
        { role: "textbox", text: "Email address", editable: true },
        { role: "textbox", text: "Password", editable: true },
        { role: "button", text: "Log in", goto: "welcome" },
        { role: "link", text: "Back to home", goto: "home" },
      ],
    },
    {
      id: "welcome",
      title: "Welcome to Clarity — your notes",
      elements: [
        { role: "heading", text: "You're all set — welcome to your notes" },
        { role: "text", text: "Account created successfully. Here's your workspace." },
        { role: "button", text: "Write your first note", goto: "welcome" },
        { role: "link", text: "Take a quick tour", goto: "welcome" },
      ],
    },
  ],
};

/** AVERAGE: workable but with mild friction — vaguer labels, an extra step. */
export const AVERAGE_APP: MockAppSpec = {
  name: "Average UX",
  start: "home",
  screens: [
    {
      id: "home",
      title: "NoteApp",
      elements: [
        { role: "heading", text: "NoteApp" },
        { role: "text", text: "A place for your notes." },
        { role: "button", text: "Sign up", goto: "plan" },
        { role: "link", text: "Sign in", goto: "login" },
        { role: "link", text: "Features", goto: "features" },
        { role: "link", text: "Pricing", goto: "plan" },
      ],
    },
    {
      id: "features",
      title: "Features — NoteApp",
      elements: [
        { role: "heading", text: "Features" },
        { role: "text", text: "Notes, folders, and search." },
        { role: "link", text: "Home", goto: "home" },
        { role: "button", text: "Sign up", goto: "plan" },
      ],
    },
    {
      id: "plan",
      title: "Choose a plan — NoteApp",
      elements: [
        { role: "heading", text: "Choose a plan" },
        { role: "button", text: "Free", goto: "signup" },
        { role: "button", text: "Pro", goto: "signup" },
        { role: "link", text: "Home", goto: "home" },
      ],
    },
    {
      id: "signup",
      title: "Register — NoteApp",
      elements: [
        { role: "heading", text: "Register" },
        { role: "textbox", text: "Email", editable: true },
        { role: "textbox", text: "Password", editable: true },
        { role: "textbox", text: "Confirm password", editable: true },
        { role: "button", text: "Continue", goto: "dashboard" },
      ],
    },
    {
      id: "login",
      title: "Sign in — NoteApp",
      elements: [
        { role: "heading", text: "Sign in" },
        { role: "textbox", text: "Email", editable: true },
        { role: "textbox", text: "Password", editable: true },
        { role: "button", text: "Sign in", goto: "dashboard" },
      ],
    },
    {
      id: "dashboard",
      title: "Dashboard — NoteApp",
      elements: [
        { role: "heading", text: "Your dashboard" },
        { role: "text", text: "Account created. Welcome to your dashboard." },
        { role: "button", text: "New note", goto: "dashboard" },
        { role: "link", text: "Settings", goto: "dashboard" },
      ],
    },
  ],
};

/**
 * BAD: hostile UX — vague CTAs, a dead-end, an error on the main path, tiny
 * low-contrast text, jargon, no back links, a long detour to succeed.
 */
export const BAD_APP: MockAppSpec = {
  name: "Bad UX",
  start: "home",
  screens: [
    {
      id: "home",
      title: "Untitled",
      elements: [
        { role: "heading", text: "PLATFORM" },
        {
          role: "text",
          text: "Synergize your workflow paradigm.",
          fontSize: 8,
          color: "#cfcfcf",
          backgroundColor: "#ffffff",
        },
        { role: "button", text: "Go", goto: "gate" },
        { role: "button", text: "Click here", goto: "dead" },
        { role: "button", text: "Submit", goto: "gate" },
        { role: "button", text: "OK", goto: "dead" },
        { role: "link", text: "?", goto: "dead" },
      ],
    },
    {
      id: "gate",
      title: "Untitled",
      elements: [
        { role: "heading", text: "AUTH" },
        {
          role: "text",
          text: "Provide OAuth token payload to initialize the webhook schema.",
          fontSize: 9,
          color: "#d0d0d0",
          backgroundColor: "#ffffff",
        },
        { role: "textbox", text: "", editable: true },
        { role: "button", text: "Proceed", goto: "err" },
      ],
    },
    {
      id: "dead",
      title: "Untitled",
      elements: [
        { role: "heading", text: "404" },
        { role: "text", text: "Nothing here." },
      ],
    },
    {
      id: "err",
      title: "Untitled",
      elements: [
        { role: "heading", text: "Error" },
        { role: "text", text: "An unexpected error occurred. Code 500. Request failed." },
        { role: "button", text: "Retry", goto: "gate2" },
      ],
    },
    {
      id: "gate2",
      title: "Untitled",
      elements: [
        { role: "heading", text: "AUTH (step 2)" },
        { role: "textbox", text: "", editable: true },
        { role: "textbox", text: "", editable: true },
        { role: "button", text: "Submit", goto: "finish" },
      ],
    },
    {
      id: "finish",
      title: "Untitled",
      elements: [
        { role: "heading", text: "Done" },
        { role: "text", text: "Your account has been created." },
      ],
    },
  ],
};

export const BENCHMARK_APPS = {
  excellent: EXCELLENT_APP,
  average: AVERAGE_APP,
  bad: BAD_APP,
} as const;

export type BenchmarkTier = keyof typeof BENCHMARK_APPS;
