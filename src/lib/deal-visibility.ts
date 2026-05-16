import type { Prisma } from "@prisma/client";
import { DEFAULT_OUTLET_ID } from "@/lib/outlets";
const DEALS_SLUG = "deals";

type VisibilityDb = Prisma.TransactionClient;

export async function refreshDealVisibility(
  db: VisibilityDb,
  outletId = DEFAULT_OUTLET_ID
): Promise<void> {
  const dealsCategory = await db.category.findFirst({
    where: { outletId, slug: DEALS_SLUG },
    select: { id: true },
  });
  if (!dealsCategory) return;

  const deals = await db.menuItem.findMany({
    where: { categoryId: dealsCategory.id },
    select: {
      id: true,
      isOutOfStock: true,
    },
  });

  for (const deal of deals) {
    if (deal.isOutOfStock) {
      await db.menuItem.update({
        where: { id: deal.id },
        data: {
          // Deals use hidden/live only. Linked item availability and expiration
          // are computed at read time; the deal shell itself should not be
          // represented as out of stock.
          isOutOfStock: false,
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    }
  }
}
