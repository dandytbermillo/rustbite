/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import {
  buildAddonLibraryCandidates,
  type AddonAuditMenuItem,
} from "@/lib/admin/shared-modifier-audit";

const prisma = new PrismaClient();

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const parsed = Number(raw.slice(prefix.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

async function loadItems(): Promise<AddonAuditMenuItem[]> {
  const items = await prisma.menuItem.findMany({
    where: {
      addons: { some: {} },
    },
    orderBy: [{ outletId: "asc" }, { name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      outletId: true,
      outlet: { select: { name: true } },
      category: { select: { slug: true, name: true } },
      addons: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          priceDelta: true,
        },
      },
    },
  });

  return items.map((item) => ({
    id: item.id,
    name: item.name,
    outletId: item.outletId,
    outletName: item.outlet.name,
    categorySlug: item.category.slug,
    categoryName: item.category.name,
    addons: item.addons,
  }));
}

async function main() {
  const json = process.argv.includes("--json");
  const minItems = numberArg("min-items", 2);
  const report = buildAddonLibraryCandidates(await loadItems(), { minItems });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Shared modifier candidate audit is read-only; no writes performed.");
  console.log("");
  console.log(`Exact reusable add-on sets: ${report.candidates.length}`);
  for (const candidate of report.candidates) {
    console.log(
      `- ${candidate.outletName}: ${candidate.suggestedGroupName} ` +
        `(${candidate.itemCount} items, ${candidate.optionCount} options)`,
    );
    console.log(
      `  Options: ${candidate.options
        .map((option) => `${option.name} ${formatMoney(option.priceDelta)}`)
        .join(", ")}`,
    );
    console.log(
      `  Items: ${candidate.items
        .map((item) => `${item.name} [${item.categoryName}]`)
        .join("; ")}`,
    );
  }

  console.log("");
  console.log(`Near matches needing review: ${report.outliers.length}`);
  for (const outlier of report.outliers) {
    console.log(
      `- ${outlier.outletName}: ${outlier.name} has price variants ` +
        outlier.prices.map(formatMoney).join(", "),
    );
    console.log(
      `  Items: ${outlier.items
        .map((item) => `${item.name} ${formatMoney(item.priceDelta)} [${item.categoryName}]`)
        .join("; ")}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
