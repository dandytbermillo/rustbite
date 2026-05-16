import assert from "node:assert/strict";
import { makeDealDraftFromHistorySnapshot } from "@/lib/admin/menu/deal-drafts";
import {
  DEAL_SCHEDULE_INVALID_RANGE_MESSAGE,
  DEFAULT_DEAL_EXPIRATION_TIME,
  dealScheduleIsoForLocalDateTime,
  dealSchedulePresetToday,
  dealSchedulePresetTomorrow,
  defaultDealEndIso,
  defaultDealStartIso,
  isOnlyTodayPresetAvailable,
  toDealScheduleDateInputValue,
  toDealScheduleTimeInputValue,
  validateDealSchedule,
} from "@/lib/deal-schedule";
import type { Category, Item } from "@/components/admin/menu-editor";
import type { MenuItemSnapshot } from "@/lib/menu-history";

function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

const morning = new Date(2026, 4, 13, 9, 15, 0, 0);
assert.equal(defaultDealStartIso(morning), morning.toISOString());
assert.equal(defaultDealEndIso(morning), localIso(2026, 5, 13, 23, 59));

assert.equal(
  dealScheduleIsoForLocalDateTime("2026-05-14", "08:30"),
  localIso(2026, 5, 14, 8, 30),
);
assert.equal(
  dealScheduleIsoForLocalDateTime("2026-05-14"),
  localIso(2026, 5, 14, 23, 59),
);
assert.equal(dealScheduleIsoForLocalDateTime("2026-02-30", "08:30"), null);
assert.equal(
  dealScheduleIsoForLocalDateTime("2026-05-14", "99:00"),
  localIso(2026, 5, 14, 23, 59),
);

const todayPreset = dealSchedulePresetToday(morning);
assert.deepEqual(todayPreset, {
  startsAt: morning.toISOString(),
  expiresAt: localIso(2026, 5, 13, 23, 59),
});

const afterCutoff = new Date(2026, 4, 13, 23, 59, 30, 0);
assert.equal(isOnlyTodayPresetAvailable(afterCutoff), false);
assert.equal(dealSchedulePresetToday(afterCutoff), null);
assert.equal(defaultDealEndIso(afterCutoff), localIso(2026, 5, 14, 23, 59));
assert.equal(
  validateDealSchedule(
    {
      startsAt: defaultDealStartIso(afterCutoff),
      expiresAt: defaultDealEndIso(afterCutoff),
    },
    afterCutoff,
  ).ok,
  true,
);

assert.deepEqual(dealSchedulePresetTomorrow(morning), {
  startsAt: localIso(2026, 5, 14, 0, 0),
  expiresAt: localIso(2026, 5, 14, 23, 59),
});

const legacyMidnight = new Date(2026, 4, 14, 0, 0, 0, 0).toISOString();
assert.equal(
  toDealScheduleDateInputValue(legacyMidnight, {
    legacyEndMidnightAsPreviousDay: true,
  }),
  "2026-05-13",
);
assert.equal(
  toDealScheduleTimeInputValue(legacyMidnight, {
    legacyEndMidnightAsPreviousDay: true,
  }),
  DEFAULT_DEAL_EXPIRATION_TIME,
);

assert.equal(
  validateDealSchedule(
    { startsAt: null, expiresAt: localIso(2026, 5, 13, 23, 59) },
    morning,
  ).status,
  "active",
);
assert.equal(
  validateDealSchedule(
    {
      startsAt: localIso(2026, 5, 13, 10, 0),
      expiresAt: localIso(2026, 5, 13, 23, 59),
    },
    morning,
  ).status,
  "scheduled",
);
assert.equal(
  validateDealSchedule(
    { startsAt: null, expiresAt: localIso(2026, 5, 13, 8, 0) },
    morning,
  ).status,
  "expired",
);
const invalid = validateDealSchedule(
  {
    startsAt: localIso(2026, 5, 13, 12, 0),
    expiresAt: localIso(2026, 5, 13, 12, 0),
  },
  morning,
);
assert.equal(invalid.ok, false);
assert.equal(invalid.status, "invalid");
assert.equal(invalid.message, DEAL_SCHEDULE_INVALID_RANGE_MESSAGE);
assert.equal(validateDealSchedule({ startsAt: null, expiresAt: null }).status, "missing");

const dealsCategory: Category = {
  id: "cat-deals",
  slug: "deals",
  name: "Deals",
  icon: "🔥",
  sortOrder: 0,
  isActive: true,
};
const burgersCategory: Category = {
  id: "cat-burgers",
  slug: "burgers",
  name: "Burgers",
  icon: "🍔",
  sortOrder: 1,
  isActive: true,
};
const baseItem: Item = {
  id: "base-burger",
  categoryId: burgersCategory.id,
  comboNum: null,
  name: "Scheduled Burger",
  description: "Base burger",
  price: 10,
  emoji: "🍔",
  bgColor: "#ffd9d1",
  badge: null,
  bundleSavings: null,
  dealBaseMenuItemId: null,
  dealBaseSizeId: null,
  dealBaseSizeNameSnapshot: null,
  dealStartsAt: null,
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
  stockUpdatedById: null,
  sortOrder: 0,
  lockVersion: 0,
  updatedAt: "",
  sizes: [{ id: "small", name: "Small", priceDelta: 0 }],
  addons: [],
  upgradeOptions: [],
};
const scheduledStartsAt = localIso(2026, 5, 15, 8, 30);
const scheduledExpiresAt = localIso(2026, 5, 15, 11, 0);
const scheduledDealSnapshot: MenuItemSnapshot = {
  id: "deleted-deal",
  categoryId: dealsCategory.id,
  comboNum: 2,
  name: "Scheduled Burger",
  description: "Scheduled deal",
  price: 8.99,
  emoji: "🍔",
  bgColor: "#ffd9d1",
  badge: "DEAL",
  mealUpgrade: null,
  mealSavings: null,
  bundleSavings: null,
  dealBaseMenuItemId: baseItem.id,
  dealBaseSizeId: "small",
  dealBaseSizeNameSnapshot: "Small",
  dealStartsAt: scheduledStartsAt,
  dealExpiresAt: scheduledExpiresAt,
  imageUrl: null,
  imageAlt: null,
  imageFit: "COVER",
  cardImageUrl: null,
  cardImageAlt: null,
  isActive: false,
  isOutOfStock: false,
  stockMode: "MANUAL",
  stockQty: null,
  lowStockThreshold: null,
  stockUpdatedAt: null,
  sortOrder: 0,
  sizes: [],
  addons: [],
  upgradeOptions: [
    {
      id: "upgrade-1",
      customTitle: null,
      extraCharge: 8.99,
      savingsLabel: null,
      discountPct: null,
      sortOrder: 0,
      linkedItems: [
        {
          id: "link-1",
          linkedMenuItemId: baseItem.id,
          linkedSizeId: "small",
          itemNameSnapshot: baseItem.name,
          sizeNameSnapshot: "Small",
          sortOrder: 0,
        },
      ],
    },
  ],
};
const restoredScheduledDeal = makeDealDraftFromHistorySnapshot({
  snapshot: scheduledDealSnapshot,
  dealsCategory,
  allItems: [baseItem],
  categories: [dealsCategory, burgersCategory],
  sortOrder: 1,
  comboNum: 3,
});
assert.equal(restoredScheduledDeal.dealStartsAt, scheduledStartsAt);
assert.equal(restoredScheduledDeal.dealExpiresAt, scheduledExpiresAt);
assert.equal(restoredScheduledDeal.dealBaseSizeId, "small");
assert.equal(restoredScheduledDeal.dealBaseSizeNameSnapshot, "Small");
assert.equal(
  restoredScheduledDeal.upgradeOptions[0]?.linkedItems[0]?.linkedSizeId,
  "small",
);

console.log("test-deal-schedule passed");
