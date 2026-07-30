/**
 * Workflow catalog: perceptual signatures of common product workflows.
 *
 * A workflow is recognized purely from what is visible — URL fragments,
 * titles, headings and control labels — the same way a person recognizes "oh,
 * this is a login page" without seeing any code.
 */

export type WorkflowKind =
  | "login"
  | "signup"
  | "forgot-password"
  | "dashboard"
  | "create"
  | "edit"
  | "delete"
  | "export"
  | "import"
  | "upload"
  | "download"
  | "settings"
  | "notifications"
  | "search"
  | "profile"
  | "navigation"
  | "form"
  | "wizard"
  | "confirmation"
  | "checkout"
  | "onboarding"
  | "help"
  | "unknown";

export interface WorkflowSignature {
  readonly kind: WorkflowKind;
  /** Matched against URL + title (strong signal). */
  readonly urlHints: readonly RegExp[];
  /** Matched against headings and prominent labels (medium signal). */
  readonly contentHints: readonly RegExp[];
  /** Labels of controls that typically belong to this workflow. */
  readonly controlHints: readonly RegExp[];
}

export const WORKFLOW_SIGNATURES: readonly WorkflowSignature[] = [
  {
    kind: "login",
    urlHints: [/\/log-?in/i, /\/signin/i, /\/auth\b/i],
    contentHints: [/\blog ?in\b/i, /\bsign ?in\b/i, /\bwelcome back\b/i],
    controlHints: [/\bpassword\b/i, /\blog ?in\b/i, /\bsign ?in\b/i],
  },
  {
    kind: "signup",
    urlHints: [/\/sign-?up/i, /\/register/i, /\/join\b/i, /\/create-?account/i],
    contentHints: [
      /\bsign ?up\b/i,
      /\bcreate (an |your )?account\b/i,
      /\bregister\b/i,
      /\bget started\b/i,
    ],
    controlHints: [/\bsign ?up\b/i, /\bcreate account\b/i, /\bregister\b/i],
  },
  {
    kind: "forgot-password",
    urlHints: [/forgot/i, /reset-?password/i, /recover/i],
    contentHints: [/\bforgot\b/i, /\breset (your )?password\b/i, /\brecover\b/i],
    controlHints: [/\breset\b/i, /\bsend (reset|recovery)\b/i],
  },
  {
    kind: "dashboard",
    urlHints: [/\/dashboard/i, /\/home\b/i, /\/overview/i, /\/app\b/i],
    contentHints: [/\bdashboard\b/i, /\boverview\b/i, /\byour \w+s\b/i, /\brecent activity\b/i],
    controlHints: [],
  },
  {
    kind: "create",
    urlHints: [/\/new\b/i, /\/create/i, /\/add\b/i],
    contentHints: [/\bnew \w+\b/i, /\bcreate\b/i, /\badd (a |an |new )\b/i],
    controlHints: [/\bcreate\b/i, /\bnew\b/i, /\badd\b/i, /\bsave\b/i],
  },
  {
    kind: "edit",
    urlHints: [/\/edit/i, /\/update/i],
    contentHints: [/\bedit\b/i, /\bupdate\b/i, /\bmodify\b/i],
    controlHints: [/\bsave( changes)?\b/i, /\bupdate\b/i, /\bapply\b/i],
  },
  {
    kind: "delete",
    urlHints: [/\/delete/i, /\/remove/i],
    contentHints: [/\bdelete\b/i, /\bremove\b/i, /\bare you sure\b/i, /\bpermanently\b/i],
    controlHints: [/\bdelete\b/i, /\bremove\b/i, /\bconfirm\b/i],
  },
  {
    kind: "export",
    urlHints: [/\/export/i],
    contentHints: [/\bexport\b/i, /\bdownload (all|your)\b/i],
    controlHints: [/\bexport\b/i, /\bdownload\b/i, /\.csv\b/i, /\.zip\b/i],
  },
  {
    kind: "import",
    urlHints: [/\/import/i],
    contentHints: [/\bimport\b/i],
    controlHints: [/\bimport\b/i, /\bchoose file\b/i],
  },
  {
    kind: "upload",
    urlHints: [/\/upload/i],
    contentHints: [/\bupload\b/i, /\bdrag (and|&) drop\b/i, /\bdrop files?\b/i],
    controlHints: [/\bupload\b/i, /\bbrowse\b/i, /\bchoose file\b/i],
  },
  {
    kind: "download",
    urlHints: [/\/download/i],
    contentHints: [/\bdownload\b/i],
    controlHints: [/\bdownload\b/i],
  },
  {
    kind: "settings",
    urlHints: [/\/settings/i, /\/preferences/i, /\/config/i, /\/account\b/i],
    contentHints: [/\bsettings\b/i, /\bpreferences\b/i, /\bconfiguration\b/i],
    controlHints: [/\bsave (changes|settings)\b/i],
  },
  {
    kind: "notifications",
    urlHints: [/\/notifications?/i, /\/alerts?\b/i],
    contentHints: [/\bnotifications?\b/i, /\balerts?\b/i],
    controlHints: [/\bmark (all )?(as )?read\b/i, /\bmute\b/i],
  },
  {
    kind: "search",
    urlHints: [/\/search/i, /[?&]q=/i, /[?&]query=/i],
    contentHints: [/\bsearch results\b/i, /\bresults for\b/i],
    controlHints: [/\bsearch\b/i, /\bfilter\b/i],
  },
  {
    kind: "profile",
    urlHints: [/\/profile/i, /\/me\b/i, /\/user\//i],
    contentHints: [/\bprofile\b/i, /\bmy account\b/i],
    controlHints: [/\bedit profile\b/i, /\bchange (photo|avatar)\b/i],
  },
  {
    kind: "checkout",
    urlHints: [/\/checkout/i, /\/cart/i, /\/payment/i, /\/billing/i],
    contentHints: [
      /\bcheckout\b/i,
      /\bshopping cart\b/i,
      /\bpayment\b/i,
      /\bbilling\b/i,
      /\border summary\b/i,
    ],
    controlHints: [/\bplace order\b/i, /\bpay\b/i, /\bcheckout\b/i],
  },
  {
    kind: "wizard",
    urlHints: [/step-?\d/i],
    contentHints: [/\bstep \d+ of \d+\b/i, /\bnext step\b/i],
    controlHints: [/\bnext\b/i, /\bprevious\b/i, /\bback\b/i, /\bfinish\b/i],
  },
  {
    kind: "confirmation",
    urlHints: [/\/(confirm|success|thank-?you|done)/i],
    contentHints: [
      /\bsuccess(fully)?\b/i,
      /\bthank you\b/i,
      /\bconfirmed?\b/i,
      /\bcheck your email\b/i,
      /\ball set\b/i,
    ],
    controlHints: [],
  },
  {
    kind: "onboarding",
    urlHints: [/\/onboarding/i, /\/welcome/i, /\/getting-?started/i],
    contentHints: [
      /\bwelcome\b/i,
      /\bgetting started\b/i,
      /\blet'?s get you set up\b/i,
      /\btake a tour\b/i,
    ],
    controlHints: [/\bskip\b/i, /\bnext\b/i, /\btake the tour\b/i],
  },
  {
    kind: "help",
    urlHints: [/\/help/i, /\/support/i, /\/docs/i, /\/faq/i],
    contentHints: [/\bhelp\b/i, /\bsupport\b/i, /\bfrequently asked\b/i, /\bdocumentation\b/i],
    controlHints: [/\bcontact (us|support)\b/i],
  },
  {
    kind: "form",
    urlHints: [],
    contentHints: [],
    // Fallback signature; the detector requires multiple editable fields.
    controlHints: [/\bsubmit\b/i, /\bsend\b/i, /\bsave\b/i],
  },
];
