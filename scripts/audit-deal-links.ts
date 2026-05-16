import { PrismaClient } from "@prisma/client";
import {
  DEAL_BASE_ISSUE_CODES,
  validateDealDefinition,
  type DealBaseValidationIssue,
} from "../src/lib/deal-base-validation";

const prisma = new PrismaClient();
const showSuggestions = process.argv.includes("--suggest");

type AuditIssue = DealBaseValidationIssue & {
  outletId: string;
  outletName: string;
};

function addIssue(
  issues: AuditIssue[],
  issue: Omit<AuditIssue, "outletId" | "outletName">,
  deal: {
    outletId: string;
    outlet: { name: string };
  }
) {
  issues.push({
    ...issue,
    outletId: deal.outletId,
    outletName: deal.outlet.name,
  });
}

function issueLine(issue: AuditIssue) {
  const pieces = [
    `[${issue.severity}]`,
    issue.code,
    `${issue.outletName}/${issue.dealName ?? issue.dealId}`,
  ];
  if (issue.menuItemId) pieces.push(`item=${issue.menuItemId}`);
  if (issue.upgradeOptionId) pieces.push(`upgrade=${issue.upgradeOptionId}`);
  if (issue.linkId) pieces.push(`link=${issue.linkId}`);
  return `${pieces.join(" ")} - ${issue.message}`;
}

async function main() {
  const [deals, nonDealItems] = await Promise.all([
    prisma.menuItem.findMany({
      where: { category: { slug: "deals" } },
      orderBy: [{ outletId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        outlet: { select: { id: true, name: true } },
        category: { select: { id: true, slug: true } },
        dealBaseMenuItem: {
          include: {
            outlet: { select: { id: true, name: true } },
            category: { select: { id: true, slug: true } },
          },
        },
        upgradeOptions: {
          orderBy: { sortOrder: "asc" },
          include: {
            linkedItems: {
              orderBy: { sortOrder: "asc" },
              include: {
                linkedMenuItem: {
                  include: {
                    category: { select: { id: true, slug: true } },
                  },
                },
                linkedSize: { select: { id: true, itemId: true, name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.menuItem.findMany({
      where: { category: { slug: { not: "deals" } } },
      orderBy: [{ outletId: "asc" }, { name: "asc" }],
      include: {
        outlet: { select: { id: true, name: true } },
        category: { select: { id: true, slug: true, name: true } },
      },
    }),
  ]);

  const issues: AuditIssue[] = [];

  for (const deal of deals) {
    for (const issue of validateDealDefinition(deal)) {
      addIssue(issues, issue, deal);
    }
  }

  if (issues.length === 0) {
    console.log("Deal link audit passed: no base/link repair issues found.");
    return;
  }

  const byCode = issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
    return counts;
  }, {});

  console.error(`Deal link audit found ${issues.length} issue(s).`);
  console.error(
    Object.entries(byCode)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, count]) => `${code}: ${count}`)
      .join(" · ")
  );
  for (const issue of issues) {
    console.error(`- ${issueLine(issue)}`);
  }

  if (showSuggestions) {
    const candidateByOutletAndName = new Map<string, typeof nonDealItems>();
    for (const item of nonDealItems) {
      const key = `${item.outletId}:${item.name.trim().toLowerCase()}`;
      const existing = candidateByOutletAndName.get(key) ?? [];
      existing.push(item);
      candidateByOutletAndName.set(key, existing);
    }

    console.error("");
    console.error("Dry-run suggestions (review only; no writes performed):");
    for (const issue of issues) {
      const lookupName =
        issue.code === DEAL_BASE_ISSUE_CODES.NESTED_DEAL_LINK
          ? issue.menuItemName
          : issue.dealName;

      if (
        issue.code === DEAL_BASE_ISSUE_CODES.MISSING_BASE ||
        issue.code === DEAL_BASE_ISSUE_CODES.BASE_NOT_FOUND ||
        issue.code === DEAL_BASE_ISSUE_CODES.BASE_POINTS_TO_DEAL ||
        issue.code === DEAL_BASE_ISSUE_CODES.BASE_CROSS_OUTLET ||
        issue.code === DEAL_BASE_ISSUE_CODES.BASE_SELF_REFERENCE ||
        issue.code === DEAL_BASE_ISSUE_CODES.NESTED_DEAL_LINK
      ) {
        const candidates = lookupName
          ? candidateByOutletAndName.get(
              `${issue.outletId}:${lookupName.trim().toLowerCase()}`
            ) ?? []
          : [];
        if (candidates.length === 0) {
          console.error(`- ${issueLine(issue)} -> no exact non-deal name match found.`);
          continue;
        }

        console.error(
          `- ${issueLine(issue)} -> possible target(s): ${candidates
            .map(
              (candidate) =>
                `${candidate.name} (${candidate.category.name}, id=${candidate.id})`
            )
            .join("; ")}`
        );
        continue;
      }

      if (issue.code === DEAL_BASE_ISSUE_CODES.LINKED_ITEM_UNAVAILABLE) {
        console.error(
          `- ${issueLine(issue)} -> restock the linked item or replace/remove this link.`
        );
        continue;
      }

      console.error(`- ${issueLine(issue)} -> manual repair required.`);
    }
  }

  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
