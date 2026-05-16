export type AutoTitleLink = {
  nameSnapshot: string;
};

export type EffectiveTitleUpgrade = {
  customTitle: string | null;
};

const SIZE_SUFFIX_RE = / · [^·]+$/;

export function autoTitle(linkedItems: AutoTitleLink[]): string {
  const parts = linkedItems
    .map((link) => link.nameSnapshot.replace(SIZE_SUFFIX_RE, "").trim().toUpperCase())
    .filter((s) => s.length > 0);

  if (parts.length === 0) return "ADD";
  return `ADD ${parts.join(" + ")}`;
}

export function effectiveTitle(
  upgradeOption: EffectiveTitleUpgrade,
  linkedItems: AutoTitleLink[]
): string {
  const custom = upgradeOption.customTitle?.trim();
  if (custom) return custom;
  return autoTitle(linkedItems);
}
