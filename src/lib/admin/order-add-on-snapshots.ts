export type AdminOrderItemAddOn = {
  name: string;
  priceDelta: number | null;
};

export type AdminOrderAddOnSetSnapshot = {
  name: string;
  options: AdminOrderItemAddOn[];
};

export type AdminOrderAddOnSnapshotDisplay = {
  itemAddOns: AdminOrderItemAddOn[];
  addOnSets: AdminOrderAddOnSetSnapshot[];
};

type RawOrderAddOn = {
  name?: unknown;
  priceDelta?: unknown;
};

type RawAddOnSetSelection = {
  name?: unknown;
  options?: unknown;
};

function numericPriceDelta(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function splitFlattenedAddOnSetName(name: string) {
  const separatorIndex = name.indexOf(": ");
  if (separatorIndex <= 0) return null;

  const setName = name.slice(0, separatorIndex).trim();
  const optionName = name.slice(separatorIndex + 2).trim();
  if (!setName || !optionName) return null;

  return { setName, optionName };
}

function rawAddonEntries(addonsJson: unknown): AdminOrderItemAddOn[] {
  if (!Array.isArray(addonsJson)) return [];

  const entries: AdminOrderItemAddOn[] = [];
  for (const rawAddOn of addonsJson as RawOrderAddOn[]) {
    if (!rawAddOn || typeof rawAddOn !== "object") continue;
    if (typeof rawAddOn.name !== "string") continue;

    const name = rawAddOn.name.trim();
    if (!name) continue;
    entries.push({
      name,
      priceDelta: numericPriceDelta(rawAddOn.priceDelta),
    });
  }
  return entries;
}

function parseStructuredAddOnSetSelections(
  addOnSetSelectionsJson: unknown,
):
  | { valid: true; addOnSets: AdminOrderAddOnSetSnapshot[] }
  | { valid: false } {
  if (!Array.isArray(addOnSetSelectionsJson)) return { valid: false };

  const addOnSets: AdminOrderAddOnSetSnapshot[] = [];
  for (const rawSelection of addOnSetSelectionsJson as RawAddOnSetSelection[]) {
    if (!rawSelection || typeof rawSelection !== "object") {
      return { valid: false };
    }
    if (
      typeof rawSelection.name !== "string" ||
      !Array.isArray(rawSelection.options)
    ) {
      return { valid: false };
    }

    const name = rawSelection.name.trim();
    if (!name) return { valid: false };

    const options: AdminOrderItemAddOn[] = [];
    for (const rawOption of rawSelection.options as RawOrderAddOn[]) {
      if (!rawOption || typeof rawOption !== "object") {
        return { valid: false };
      }
      if (typeof rawOption.name !== "string") return { valid: false };

      const optionName = rawOption.name.trim();
      if (!optionName) return { valid: false };
      options.push({
        name: optionName,
        priceDelta: numericPriceDelta(rawOption.priceDelta),
      });
    }

    addOnSets.push({ name, options });
  }

  return { valid: true, addOnSets };
}

export function parseAdminOrderAddOnSnapshots(
  addonsJson: unknown,
  addOnSetSelectionsJson?: unknown,
): AdminOrderAddOnSnapshotDisplay {
  const structured = parseStructuredAddOnSetSelections(addOnSetSelectionsJson);
  if (structured.valid) {
    const structuredFlatNameCounts = new Map<string, number>();
    for (const set of structured.addOnSets) {
      for (const option of set.options) {
        const flatName = `${set.name}: ${option.name}`;
        structuredFlatNameCounts.set(
          flatName,
          (structuredFlatNameCounts.get(flatName) ?? 0) + 1,
        );
      }
    }

    const flatEntries = rawAddonEntries(addonsJson);
    const consumedFlatIndexes = new Set<number>();
    for (let index = flatEntries.length - 1; index >= 0; index -= 1) {
      const addOn = flatEntries[index]!;
      const remainingStructuredCount =
        structuredFlatNameCounts.get(addOn.name) ?? 0;
      if (remainingStructuredCount <= 0) continue;

      consumedFlatIndexes.add(index);
      if (remainingStructuredCount === 1) {
        structuredFlatNameCounts.delete(addOn.name);
      } else {
        structuredFlatNameCounts.set(addOn.name, remainingStructuredCount - 1);
      }
    }

    return {
      itemAddOns: flatEntries.filter(
        (_, index) => !consumedFlatIndexes.has(index),
      ),
      addOnSets: structured.addOnSets,
    };
  }

  const itemAddOns: AdminOrderItemAddOn[] = [];
  const groupedAddOnSets = new Map<string, AdminOrderAddOnSetSnapshot>();

  const entries = rawAddonEntries(addonsJson);
  if (entries.length === 0) {
    return { itemAddOns, addOnSets: [] };
  }

  for (const addOn of entries) {
    const flattenedSet = splitFlattenedAddOnSetName(addOn.name);
    if (!flattenedSet) {
      itemAddOns.push(addOn);
      continue;
    }

    const existing = groupedAddOnSets.get(flattenedSet.setName);
    const setSnapshot =
      existing ??
      ({
        name: flattenedSet.setName,
        options: [],
      } satisfies AdminOrderAddOnSetSnapshot);
    setSnapshot.options.push({
      name: flattenedSet.optionName,
      priceDelta: addOn.priceDelta,
    });
    groupedAddOnSets.set(flattenedSet.setName, setSnapshot);
  }

  return {
    itemAddOns,
    addOnSets: Array.from(groupedAddOnSets.values()),
  };
}
