import { Prisma } from "@prisma/client";
import {
  DEAL_BASE_ISSUE_CODES,
  validateDealDefinition,
  validateOptionalDealBaseReference,
} from "../src/lib/deal-base-validation";
import {
  diagnoseMenuSnapshotDealBaseRestore,
  itemSnapshotFromRecord,
  parseMenuSnapshot,
} from "../src/lib/menu-history";
import { enrichUpgradeOptions } from "../src/lib/menu-admin";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const legacyRawSnapshot = {
  categories: [
    {
      id: "cat-deals",
      slug: "deals",
      name: "Deals",
      icon: "🔥",
      sortOrder: 0,
      isActive: true,
    },
  ],
  items: [
    {
      id: "deal-legacy",
      categoryId: "cat-deals",
      comboNum: 1,
      name: "Legacy Deal",
      description: "Old snapshot without dealBaseMenuItemId.",
      price: 6,
      emoji: "🔥",
      bgColor: "#fff3b0",
      badge: "DEAL",
      mealUpgrade: null,
      mealSavings: null,
      bundleSavings: null,
      dealExpiresAt: null,
      imageUrl: null,
      imageAlt: null,
      imageFit: "COVER",
      cardImageUrl: null,
      cardImageAlt: null,
      isActive: false,
      isOutOfStock: false,
      sortOrder: 0,
      sizes: [],
      addons: [],
      upgradeOptions: [],
    },
  ],
};

const parsedLegacy = parseMenuSnapshot(legacyRawSnapshot);
assert(
  parsedLegacy.items[0]?.dealBaseMenuItemId === null,
  "Old snapshots must parse missing dealBaseMenuItemId as null."
);
assert(
  parsedLegacy.items[0]?.dealBaseSizeId === null &&
    parsedLegacy.items[0]?.dealBaseSizeNameSnapshot === null,
  "Old snapshots must parse missing deal base size as null."
);

const diagnostics = diagnoseMenuSnapshotDealBaseRestore(parsedLegacy);
assert(
  diagnostics.some((issue) => issue.code === DEAL_BASE_ISSUE_CODES.MISSING_BASE),
  "Legacy deal snapshots should report a repair-needed missing base."
);

const badRawSnapshot = {
  ...legacyRawSnapshot,
  items: [{ ...legacyRawSnapshot.items[0], dealBaseMenuItemId: 123 }],
};
let invalidBaseRejected = false;
try {
  parseMenuSnapshot(badRawSnapshot);
} catch {
  invalidBaseRejected = true;
}
assert(invalidBaseRejected, "Non-string dealBaseMenuItemId should be rejected.");

const badBaseSizeSnapshot = {
  ...legacyRawSnapshot,
  items: [{ ...legacyRawSnapshot.items[0], dealBaseSizeId: 123 }],
};
let invalidBaseSizeRejected = false;
try {
  parseMenuSnapshot(badBaseSizeSnapshot);
} catch {
  invalidBaseSizeRejected = true;
}
assert(invalidBaseSizeRejected, "Non-string dealBaseSizeId should be rejected.");

const recordSnapshot = itemSnapshotFromRecord({
  id: "deal-current",
  categoryId: "cat-deals",
  comboNum: 2,
  name: "Current Deal",
  description: "Current snapshot with explicit base identity.",
  price: new Prisma.Decimal(8),
  emoji: "🔥",
  bgColor: "#fff3b0",
  badge: "DEAL",
  mealUpgrade: null,
  mealSavings: null,
  bundleSavings: null,
  dealBaseMenuItemId: "burger-1",
  dealBaseSizeId: "size-medium",
  dealBaseSizeNameSnapshot: "Medium",
  dealExpiresAt: null,
  imageUrl: null,
  imageAlt: null,
  imageFit: "COVER",
  cardImageUrl: null,
  cardImageAlt: null,
  isActive: true,
  isOutOfStock: false,
  stockMode: "MANUAL",
  stockQty: null,
  lowStockThreshold: null,
  stockUpdatedAt: null,
  sortOrder: 0,
  sizes: [],
  addons: [],
  upgradeOptions: [],
});
assert(
  recordSnapshot.dealBaseMenuItemId === "burger-1",
  "Current snapshots must carry explicit dealBaseMenuItemId."
);
assert(
  recordSnapshot.dealBaseSizeId === "size-medium" &&
    recordSnapshot.dealBaseSizeNameSnapshot === "Medium",
  "Current snapshots must carry explicit deal base size identity."
);

const validBaseIssues = validateOptionalDealBaseReference({
  id: "deal-current",
  name: "Current Deal",
  outletId: "cafeteria",
  dealBaseMenuItemId: "burger-1",
  dealBaseMenuItem: {
    id: "burger-1",
    outletId: "cafeteria",
    name: "Burger",
    category: { id: "cat-burgers", slug: "burgers" },
  },
});
assert(validBaseIssues.length === 0, "Valid optional base reference should pass.");

const nestedLinkIssues = validateDealDefinition({
  id: "deal-current",
  name: "Current Deal",
  outletId: "cafeteria",
  dealBaseMenuItemId: "burger-1",
  dealBaseMenuItem: {
    id: "burger-1",
    outletId: "cafeteria",
    name: "Burger",
    category: { id: "cat-burgers", slug: "burgers" },
  },
  upgradeOptions: [
    {
      id: "upgrade-1",
      linkedItems: [
        {
          id: "link-1",
          linkedMenuItemId: "deal-other",
          linkedSizeId: null,
          linkedMenuItem: {
            id: "deal-other",
            outletId: "cafeteria",
            name: "Other Deal",
            category: { id: "cat-deals", slug: "deals" },
          },
          linkedSize: null,
        },
      ],
    },
  ],
});
assert(
  nestedLinkIssues.some((issue) => issue.code === DEAL_BASE_ISSUE_CODES.NESTED_DEAL_LINK),
  "Shared validator should detect nested deal links."
);

async function assertEnrichmentRejectsNestedDealLinks() {
  const enriched = await enrichUpgradeOptions(
    [
      {
        id: undefined,
        customTitle: null,
        extraCharge: 1,
        savingsLabel: null,
        discountPct: null,
        sortOrder: 0,
        linkedItems: [
          {
            id: undefined,
            linkedMenuItemId: "deal-other",
            linkedSizeId: null,
            itemNameSnapshot: null,
            sortOrder: 0,
          },
        ],
      },
    ],
    {
      parentItemId: "deal-current",
      existingUpgradeOptions: [],
      loadMenuItem: async () => ({
        id: "deal-other",
        name: "Other Deal",
        isActive: true,
        isOutOfStock: false,
        category: { slug: "deals" },
        sizes: [],
      }),
    }
  );

  assert(
    enriched.error?.includes("cannot reference another deal"),
    "New or changed upgrade links should reject nested deal references."
  );
}

assertEnrichmentRejectsNestedDealLinks()
  .then(() => {
    console.log("Deal base identity compatibility test passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
