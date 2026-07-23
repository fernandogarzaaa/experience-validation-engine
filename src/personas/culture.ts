import type { Persona } from "./persona.js";

/**
 * Cultural personas.
 *
 * Cultural profile shapes how an interface is read and what conventions the
 * operator expects: reading direction, date/number/currency formats,
 * privacy and form expectations, navigation habits. Mismatches between the
 * operator's expectations and the interface are perceived as friction and
 * lower trust (Marcus & Gould 2000 on culture in UI; Hofstede dimensions as
 * a coarse background). EVE uses the profile to (a) drive attention scanning
 * direction and (b) flag localization/convention mismatches as findings.
 */

export interface CultureProfile {
  readonly locale: string;
  readonly name: string;
  readonly readingDirection: "ltr" | "rtl";
  /** Expected date pattern, checked against visible dates. */
  readonly dateFormat: "MDY" | "DMY" | "YMD";
  /** Expected currency symbol/code. */
  readonly currency: string;
  /** Decimal separator the operator expects. */
  readonly decimalSeparator: "." | ",";
  /** First day of week (0 = Sunday). */
  readonly firstDayOfWeek: 0 | 1;
  /** Elevated sensitivity to privacy/data requests (0..1). */
  readonly privacyExpectation: number;
  /** Name order the operator expects in forms. */
  readonly nameOrder: "given-family" | "family-given";
  readonly languageHints: readonly string[];
}

export const CULTURES: Record<string, CultureProfile> = {
  "en-US": {
    locale: "en-US",
    name: "United States (English)",
    readingDirection: "ltr",
    dateFormat: "MDY",
    currency: "$",
    decimalSeparator: ".",
    firstDayOfWeek: 0,
    privacyExpectation: 0.4,
    nameOrder: "given-family",
    languageHints: ["color", "center", "zip"],
  },
  "en-GB": {
    locale: "en-GB",
    name: "United Kingdom (English)",
    readingDirection: "ltr",
    dateFormat: "DMY",
    currency: "£",
    decimalSeparator: ".",
    firstDayOfWeek: 1,
    privacyExpectation: 0.6,
    nameOrder: "given-family",
    languageHints: ["colour", "centre", "postcode"],
  },
  "de-DE": {
    locale: "de-DE",
    name: "Germany (German)",
    readingDirection: "ltr",
    dateFormat: "DMY",
    currency: "€",
    decimalSeparator: ",",
    firstDayOfWeek: 1,
    privacyExpectation: 0.85,
    nameOrder: "given-family",
    languageHints: ["Anmelden", "Datenschutz", "Konto"],
  },
  "fr-FR": {
    locale: "fr-FR",
    name: "France (French)",
    readingDirection: "ltr",
    dateFormat: "DMY",
    currency: "€",
    decimalSeparator: ",",
    firstDayOfWeek: 1,
    privacyExpectation: 0.75,
    nameOrder: "given-family",
    languageHints: ["Connexion", "Compte", "Rechercher"],
  },
  "ja-JP": {
    locale: "ja-JP",
    name: "Japan (Japanese)",
    readingDirection: "ltr",
    dateFormat: "YMD",
    currency: "¥",
    decimalSeparator: ".",
    firstDayOfWeek: 0,
    privacyExpectation: 0.7,
    nameOrder: "family-given",
    languageHints: ["ログイン", "アカウント", "検索"],
  },
  "ar-SA": {
    locale: "ar-SA",
    name: "Saudi Arabia (Arabic)",
    readingDirection: "rtl",
    dateFormat: "DMY",
    currency: "﷼",
    decimalSeparator: ".",
    firstDayOfWeek: 0,
    privacyExpectation: 0.7,
    nameOrder: "given-family",
    languageHints: ["تسجيل الدخول", "حساب", "بحث"],
  },
  "he-IL": {
    locale: "he-IL",
    name: "Israel (Hebrew)",
    readingDirection: "rtl",
    dateFormat: "DMY",
    currency: "₪",
    decimalSeparator: ".",
    firstDayOfWeek: 0,
    privacyExpectation: 0.65,
    nameOrder: "given-family",
    languageHints: ["התחברות", "חשבון", "חיפוש"],
  },
};

export const DEFAULT_CULTURE = CULTURES["en-US"]!;

export function listCultures(): readonly CultureProfile[] {
  return Object.values(CULTURES);
}

export function getCulture(locale: string): CultureProfile {
  const c = CULTURES[locale];
  if (!c) throw new Error(`Unknown culture "${locale}". Known: ${Object.keys(CULTURES).join(", ")}`);
  return c;
}

/**
 * A persona carrying a cultural profile. Reading direction and privacy
 * sensitivity are read by the attention model and trust/vision checks.
 */
export interface CulturedPersona extends Persona {
  readonly culture: CultureProfile;
}

export function withCulture(persona: Persona, culture: CultureProfile): CulturedPersona {
  return { ...persona, culture };
}

export function cultureOf(persona: Persona): CultureProfile {
  return (persona as CulturedPersona).culture ?? DEFAULT_CULTURE;
}
