import { ADMIN_MENU_BADGES } from "@/lib/menu-admin";
import type { Cat } from "@/lib/admin/menu/visibility";
import {
  MENU_ATTENTION_VALUES,
  MENU_STATUS_VALUES,
  MENU_STOCK_VALUES,
  type MenuAttention,
  type MenuFilterStructuredKey,
} from "./types";

export type FieldOption = {
  value: string;
  label: string;
};

export type FieldCatalogueEntry = {
  key: MenuFilterStructuredKey;
  label: string;
  description: string;
  options: FieldOption[];
};

const ATTENTION_LABELS: Record<MenuAttention, string> = {
  deals: "Deals need attention",
  "inventory-out": "Items out of stock",
  "inventory-low": "Low-stock items",
};

/**
 * Build the field catalogue used by autocomplete, the builder modal, and chip
 * label rendering. Includes inactive categories so admins can find/manage
 * hidden categories through filters.
 */
export function buildFieldCatalogue(
  categories: Cat[],
): FieldCatalogueEntry[] {
  const sortedCategories = [...categories].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });

  return [
    {
      key: "category",
      label: "Category",
      description: "Filter by category slug (e.g. category:deals).",
      options: sortedCategories.map((c) => ({
        value: c.slug,
        label: c.isActive ? c.name : `${c.name} (hidden)`,
      })),
    },
    {
      key: "badge",
      label: "Badge",
      description: "Filter by badge tag (e.g. badge:HOT).",
      options: ADMIN_MENU_BADGES.map((b) => ({ value: b, label: b })),
    },
    {
      key: "status",
      label: "Status",
      description: "live / hidden / expired",
      options: MENU_STATUS_VALUES.map((v) => ({ value: v, label: v })),
    },
    {
      key: "stock",
      label: "Stock",
      description: "in / out",
      options: MENU_STOCK_VALUES.map((v) => ({ value: v, label: v })),
    },
    {
      key: "attention",
      label: "Attention",
      description: "Surface rows that need operator action.",
      options: MENU_ATTENTION_VALUES.map((v) => ({
        value: v,
        label: ATTENTION_LABELS[v],
      })),
    },
  ];
}

export function findFieldEntry(
  catalogue: FieldCatalogueEntry[],
  key: string,
): FieldCatalogueEntry | undefined {
  return catalogue.find((entry) => entry.key === key);
}

export function isValidFieldValue(
  catalogue: FieldCatalogueEntry[],
  key: string,
  value: string,
): boolean {
  const entry = findFieldEntry(catalogue, key);
  if (!entry) return false;
  return entry.options.some((option) => option.value === value);
}
