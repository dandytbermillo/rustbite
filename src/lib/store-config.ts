import type { OrderType, PaymentMethod } from "./types";

export type ServiceModel = "PICKUP_ONLY" | "TABLE_SERVICE";
export type PaymentMode = "MOCK" | "TERMINAL";
export type SupportedLanguage = "en" | "fr";

const ALL_PAYMENT_METHODS: PaymentMethod[] = ["CARD", "MOBILE", "CASH"];
const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = ["CARD", "MOBILE", "CASH"];
const ALL_LANGUAGES: SupportedLanguage[] = ["en", "fr"];

function parseNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseServiceModel(raw: string | undefined): ServiceModel {
  return raw === "TABLE_SERVICE" ? "TABLE_SERVICE" : "PICKUP_ONLY";
}

function parsePaymentMode(raw: string | undefined): PaymentMode {
  return raw === "TERMINAL" ? "TERMINAL" : "MOCK";
}

function parseCsvEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: readonly T[]
): T[] {
  const tokens = (raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  const parsed = tokens
    .map((token) =>
      allowed.find((value) => value.toLowerCase() === token.toLowerCase())
    )
    .filter((value): value is T => !!value);

  return parsed.length > 0 ? Array.from(new Set(parsed)) : [...fallback];
}

export const STORE_CONFIG = {
  storeName: process.env.NEXT_PUBLIC_STORE_NAME ?? "Rushbite",
  storeLocation: process.env.NEXT_PUBLIC_STORE_LOCATION ?? "Sherwood Park, AB",
  kioskId: process.env.NEXT_PUBLIC_KIOSK_ID ?? "01",
  serviceModel: parseServiceModel(process.env.NEXT_PUBLIC_SERVICE_MODEL),
  paymentMode: parsePaymentMode(process.env.NEXT_PUBLIC_PAYMENT_MODE),
  paymentMethods: parseCsvEnum(
    process.env.NEXT_PUBLIC_PAYMENT_METHODS,
    ALL_PAYMENT_METHODS,
    DEFAULT_PAYMENT_METHODS
  ),
  supportedLanguages: parseCsvEnum(
    process.env.NEXT_PUBLIC_SUPPORTED_LANGUAGES,
    ALL_LANGUAGES,
    ["en"]
  ),
  prepMinutes: parseNumber(process.env.NEXT_PUBLIC_PREP_MINUTES, 6),
  orderResetSeconds: parseNumber(
    process.env.NEXT_PUBLIC_ORDER_RESET_SECONDS,
    20
  ),
} as const;

export function hasLanguage(lang: SupportedLanguage): boolean {
  return STORE_CONFIG.supportedLanguages.includes(lang);
}

export function formatOrderTypeLabel(orderType: OrderType): string {
  if (STORE_CONFIG.serviceModel === "TABLE_SERVICE") {
    return orderType === "DINE_IN" ? "DINE IN" : "TAKE OUT";
  }
  return orderType === "DINE_IN" ? "FOR HERE" : "TO GO";
}

export function getOrderTypePresentation(orderType: OrderType): {
  eyebrow: string;
  title: string;
  description: string;
  badge: string;
} {
  if (STORE_CONFIG.serviceModel === "TABLE_SERVICE") {
    return orderType === "DINE_IN"
      ? {
          eyebrow: "EAT WITH US",
          title: "DINE IN",
          description: "We'll bring your tray to your table.",
          badge: "FREE REFILLS",
        }
      : {
          eyebrow: "ON THE GO",
          title: "TAKE OUT",
          description: "Packed up fresh and ready to grab.",
          badge: "READY FAST",
        };
  }

  return orderType === "DINE_IN"
    ? {
        eyebrow: "CAFETERIA",
        title: "FOR HERE",
        description: "Enjoy it in the dining area after pickup is called.",
        badge: "WATCH THE BOARD",
      }
    : {
        eyebrow: "ON THE GO",
        title: "TO GO",
        description: "Packed for pickup so you can head out quickly.",
        badge: "GRAB & GO",
      };
}

export function getConfirmationMessage(orderType: OrderType): string {
  if (STORE_CONFIG.serviceModel === "TABLE_SERVICE") {
    return orderType === "DINE_IN"
      ? "Grab a seat — we'll bring it right over."
      : "Head to pickup when your number's called.";
  }

  return orderType === "DINE_IN"
    ? "Watch the board for your number, then pick up your tray at the counter."
    : "Head to pickup when your number's called.";
}
