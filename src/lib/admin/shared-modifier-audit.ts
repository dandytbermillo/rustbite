import { normalizeSharedModifierName } from "@/lib/shared-modifier-library";

export type AddonAuditOption = {
  id: string;
  name: string;
  priceDelta: number | string | { toString(): string };
};

export type AddonAuditMenuItem = {
  id: string;
  name: string;
  outletId: string;
  outletName: string;
  categorySlug: string;
  categoryName: string;
  addons: AddonAuditOption[];
};

export type AddonLibraryCandidateOption = {
  name: string;
  normalizedName: string;
  priceDelta: number;
};

export type AddonLibraryCandidateItem = {
  id: string;
  name: string;
  categorySlug: string;
  categoryName: string;
};

export type AddonLibraryCandidate = {
  outletId: string;
  outletName: string;
  suggestedGroupName: string;
  signature: string;
  optionCount: number;
  itemCount: number;
  options: AddonLibraryCandidateOption[];
  items: AddonLibraryCandidateItem[];
};

export type AddonLibraryOutlier = {
  outletId: string;
  outletName: string;
  name: string;
  normalizedName: string;
  prices: number[];
  items: Array<AddonLibraryCandidateItem & { priceDelta: number }>;
};

export type AddonLibraryAuditReport = {
  candidates: AddonLibraryCandidate[];
  outliers: AddonLibraryOutlier[];
};

function numberValue(value: number | string | { toString(): string }): number {
  return typeof value === "number" ? value : Number(value.toString());
}

function moneyKey(value: number): string {
  return value.toFixed(2);
}

function itemSummary(item: AddonAuditMenuItem): AddonLibraryCandidateItem {
  return {
    id: item.id,
    name: item.name,
    categorySlug: item.categorySlug,
    categoryName: item.categoryName,
  };
}

function optionSummary(option: AddonAuditOption): AddonLibraryCandidateOption {
  return {
    name: option.name.trim(),
    normalizedName: normalizeSharedModifierName(option.name),
    priceDelta: numberValue(option.priceDelta),
  };
}

function displayNameForOption(
  items: AddonAuditMenuItem[],
  option: AddonLibraryCandidateOption,
): string {
  const names = items
    .flatMap((item) => item.addons)
    .map(optionSummary)
    .filter(
      (candidate) =>
        candidate.normalizedName === option.normalizedName &&
        moneyKey(candidate.priceDelta) === moneyKey(option.priceDelta),
    )
    .map((candidate) => candidate.name)
    .filter(Boolean)
    .sort((a, b) => {
      const aLower = a === a.toLowerCase();
      const bLower = b === b.toLowerCase();
      if (aLower !== bLower) return aLower ? 1 : -1;
      return a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b);
    });
  return names[0] ?? option.name;
}

function signatureForOptions(options: AddonLibraryCandidateOption[]): string {
  return options
    .map((option) => `${option.normalizedName}:${moneyKey(option.priceDelta)}`)
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

function suggestedGroupName(items: AddonAuditMenuItem[]): string {
  const categoryNames = Array.from(new Set(items.map((item) => item.categoryName.trim()).filter(Boolean)));
  if (categoryNames.length === 1) return `${categoryNames[0]} add-ons`;
  return "Shared add-ons";
}

export function buildAddonLibraryCandidates(
  items: AddonAuditMenuItem[],
  options: { minItems?: number } = {},
): AddonLibraryAuditReport {
  const minItems = options.minItems ?? 2;
  const exactGroups = new Map<
    string,
    {
      outletId: string;
      outletName: string;
      signature: string;
      options: AddonLibraryCandidateOption[];
      items: AddonAuditMenuItem[];
    }
  >();
  const optionUsage = new Map<
    string,
    {
      outletId: string;
      outletName: string;
      name: string;
      normalizedName: string;
      prices: Map<string, { priceDelta: number; items: AddonAuditMenuItem[] }>;
    }
  >();

  for (const item of items) {
    const normalizedOptions = item.addons
      .map(optionSummary)
      .filter((option) => option.normalizedName)
      .sort(
        (a, b) =>
          a.normalizedName.localeCompare(b.normalizedName) ||
          a.priceDelta - b.priceDelta,
      );
    if (normalizedOptions.length > 0) {
      const signature = signatureForOptions(normalizedOptions);
      const key = `${item.outletId}:${signature}`;
      const existing = exactGroups.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        exactGroups.set(key, {
          outletId: item.outletId,
          outletName: item.outletName,
          signature,
          options: normalizedOptions,
          items: [item],
        });
      }
    }

    for (const option of normalizedOptions) {
      const usageKey = `${item.outletId}:${option.normalizedName}`;
      const usage = optionUsage.get(usageKey) ?? {
        outletId: item.outletId,
        outletName: item.outletName,
        name: option.name,
        normalizedName: option.normalizedName,
        prices: new Map<string, { priceDelta: number; items: AddonAuditMenuItem[] }>(),
      };
      const priceKey = moneyKey(option.priceDelta);
      const priceUsage = usage.prices.get(priceKey) ?? {
        priceDelta: option.priceDelta,
        items: [],
      };
      priceUsage.items.push(item);
      usage.prices.set(priceKey, priceUsage);
      optionUsage.set(usageKey, usage);
    }
  }

  const candidates = Array.from(exactGroups.values())
    .filter((group) => group.items.length >= minItems)
    .map((group): AddonLibraryCandidate => ({
      outletId: group.outletId,
      outletName: group.outletName,
      suggestedGroupName: suggestedGroupName(group.items),
      signature: group.signature,
      optionCount: group.options.length,
      itemCount: group.items.length,
      options: [...group.options].sort(
        (a, b) =>
          a.normalizedName.localeCompare(b.normalizedName) ||
          a.priceDelta - b.priceDelta,
      ).map((option) => ({
        ...option,
        name: displayNameForOption(group.items, option),
      })),
      items: group.items
        .map(itemSummary)
        .sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.name.localeCompare(b.name)),
    }))
    .sort(
      (a, b) =>
        a.outletName.localeCompare(b.outletName) ||
        b.itemCount - a.itemCount ||
        a.suggestedGroupName.localeCompare(b.suggestedGroupName) ||
        a.signature.localeCompare(b.signature),
    );

  const outliers = Array.from(optionUsage.values())
    .filter((usage) => usage.prices.size > 1)
    .map((usage): AddonLibraryOutlier => ({
      outletId: usage.outletId,
      outletName: usage.outletName,
      name: usage.name,
      normalizedName: usage.normalizedName,
      prices: Array.from(usage.prices.values())
        .map((entry) => entry.priceDelta)
        .sort((a, b) => a - b),
      items: Array.from(usage.prices.values())
        .flatMap((entry) =>
          entry.items.map((item) => ({
            ...itemSummary(item),
            priceDelta: entry.priceDelta,
          })),
        )
        .sort(
          (a, b) =>
            a.priceDelta - b.priceDelta ||
            a.categoryName.localeCompare(b.categoryName) ||
            a.name.localeCompare(b.name),
        ),
    }))
    .sort(
      (a, b) =>
        a.outletName.localeCompare(b.outletName) ||
        a.normalizedName.localeCompare(b.normalizedName),
    );

  return { candidates, outliers };
}
