/* eslint-disable no-console */
import { PrismaClient, Prisma } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();
const DEFAULT_OUTLET_ID = "cafeteria";

type Mod = { id: string; name: string; price: number };

const CATEGORIES: { slug: string; name: string; icon: string }[] = [
  { slug: "deals", name: "Deals", icon: "🔥" },
  { slug: "burgers", name: "Burgers", icon: "🍔" },
  { slug: "chicken", name: "Chicken", icon: "🍗" },
  { slug: "breakfast", name: "Breakfast", icon: "🥞" },
  { slug: "sides", name: "Sides", icon: "🍟" },
  { slug: "drinks", name: "Drinks", icon: "🥤" },
  { slug: "desserts", name: "Desserts", icon: "🍦" },
  { slug: "kids", name: "Kids", icon: "🧸" },
];

const SIZES: Mod[] = [
  { id: "sm", name: "Small", price: 0 },
  { id: "md", name: "Medium", price: 1.3 },
  { id: "lg", name: "Large", price: 2.6 },
];

const BURGER_ADDONS: Mod[] = [
  { id: "cheese", name: "🧀 Extra cheese", price: 1.0 },
  { id: "bacon", name: "🥓 Crispy bacon", price: 1.75 },
  { id: "pickle", name: "🥒 Extra pickles", price: 0.3 },
  { id: "jal", name: "🌶️ Jalapeños", price: 0.5 },
  { id: "no-onion", name: "🧅 No onion", price: 0 },
  { id: "no-pickle", name: "🥒 No pickles", price: 0 },
  { id: "no-sauce", name: "🥫 No sauce", price: 0 },
  { id: "no-salt", name: "🧂 No salt", price: 0 },
];

type SeedItem = {
  slug: string;
  comboNum?: number;
  name: string;
  description: string;
  price: number;
  emoji: string;
  bg: string;
  category: string;
  badge?: "NEW" | "POPULAR" | "DEAL" | "HOT";
  sizes?: Mod[];
  addons?: Mod[];
  mealUpgrade?: number;
  mealSavings?: number;
  bundleSavings?: number;
  upgradeOptions?: Array<{
    customTitle?: string;
    extraCharge: number;
    savingsLabel?: number;
    linkedItems: Array<{
      itemSlug: string;
      sizeId?: string;
    }>;
  }>;
};

const ITEMS: SeedItem[] = [
  { slug: "deal1", comboNum: 1, name: "Big Double Combo", description: "Double beef, two cheese, fries & drink", price: 11.99, emoji: "🍔", bg: "#FFE3B3", category: "deals", badge: "DEAL", mealSavings: 2.5, bundleSavings: 2.5 },
  { slug: "deal2", comboNum: 2, name: "Crispy Chicken Combo", description: "Crispy chicken sandwich, fries & drink", price: 10.99, emoji: "🍗", bg: "#FFD9D1", category: "deals", badge: "DEAL", mealSavings: 2.2, bundleSavings: 2.2 },
  { slug: "deal3", comboNum: 3, name: "2 For $6 Mix & Match", description: "Pick any 2: burger, nuggets, wrap, or fries", price: 6.0, emoji: "🎯", bg: "#FFF3B0", category: "deals", badge: "HOT" },
  { slug: "deal4", name: "Family Bundle", description: "4 burgers, 4 fries, 4 drinks — feeds a crew", price: 29.99, emoji: "🍟", bg: "#FFD9D1", category: "deals", badge: "POPULAR" },

  { slug: "b1", comboNum: 1, name: "The Double Stack", description: "Two beef patties, two cheese, onion, pickle, signature sauce", price: 7.49, emoji: "🍔", bg: "#FFE3B3", category: "burgers", badge: "POPULAR", mealUpgrade: 3.8, sizes: SIZES, addons: BURGER_ADDONS, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },
  { slug: "b2", comboNum: 2, name: "Bacon Cheddar", description: "Quarter-pound beef, cheddar, crispy bacon, smoky mayo", price: 8.99, emoji: "🍔", bg: "#FFD9D1", category: "burgers", mealUpgrade: 3.8, sizes: SIZES, addons: BURGER_ADDONS, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },
  { slug: "b3", comboNum: 3, name: "Classic Cheeseburger", description: "Single patty, American cheese, ketchup, mustard, onion, pickle", price: 4.49, emoji: "🍔", bg: "#FFF3B0", category: "burgers", mealUpgrade: 3.8, sizes: SIZES, addons: BURGER_ADDONS, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },
  { slug: "b4", comboNum: 4, name: "Mushroom Swiss", description: "Sautéed mushrooms, swiss cheese, caramelized onion", price: 8.49, emoji: "🍔", bg: "#E8DCC4", category: "burgers", mealUpgrade: 3.8, sizes: SIZES, addons: BURGER_ADDONS, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },
  { slug: "b5", comboNum: 5, name: "Spicy Jalapeño", description: "Beef, pepper jack, jalapeños, chipotle mayo", price: 8.29, emoji: "🌶️", bg: "#FFD9D1", category: "burgers", badge: "HOT", mealUpgrade: 3.8, sizes: SIZES, addons: BURGER_ADDONS, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },
  { slug: "b6", comboNum: 6, name: "Garden Veggie", description: "Crispy plant-based patty, avocado, tomato, lettuce", price: 7.99, emoji: "🥗", bg: "#D9EBC7", category: "burgers", badge: "NEW", mealUpgrade: 3.8, sizes: SIZES, addons: BURGER_ADDONS, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },

  { slug: "c1", comboNum: 7, name: "Crispy Chicken Sandwich", description: "Buttermilk-fried breast, pickles, brioche bun", price: 7.79, emoji: "🍗", bg: "#FFF3B0", category: "chicken", badge: "POPULAR", mealUpgrade: 3.8, addons: BURGER_ADDONS, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },
  { slug: "c2", comboNum: 8, name: "Spicy Chicken Sandwich", description: "Nashville-hot, slaw, pickle", price: 8.29, emoji: "🌶️", bg: "#FFD9D1", category: "chicken", badge: "HOT", mealUpgrade: 3.8, addons: BURGER_ADDONS, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },
  { slug: "c3", name: "Chicken Nuggets (6pc)", description: "Choice of dipping sauce", price: 5.49, emoji: "🍗", bg: "#FFE3B3", category: "chicken", mealUpgrade: 3.8, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },
  { slug: "c4", name: "Chicken Nuggets (10pc)", description: "Choice of dipping sauce", price: 7.99, emoji: "🍗", bg: "#FFE3B3", category: "chicken", mealUpgrade: 3.8, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },
  { slug: "c5", name: "Grilled Chicken Wrap", description: "Lettuce, tomato, ranch, cheddar", price: 6.49, emoji: "🌯", bg: "#D9EBC7", category: "chicken", mealUpgrade: 3.8, upgradeOptions: [{ extraCharge: 3.8, savingsLabel: 2.0, linkedItems: [{ itemSlug: "s1", sizeId: "sm" }, { itemSlug: "d1", sizeId: "sm" }] }] },

  { slug: "br1", name: "Bacon & Egg Muffin", description: "English muffin, bacon, egg, American cheese", price: 4.99, emoji: "🥓", bg: "#FFE3B3", category: "breakfast", badge: "POPULAR", mealUpgrade: 3.3, upgradeOptions: [{ extraCharge: 3.3, savingsLabel: 1.75, linkedItems: [{ itemSlug: "br5" }, { itemSlug: "d5" }] }] },
  { slug: "br2", name: "Sausage Biscuit", description: "Buttermilk biscuit, sausage, egg, cheese", price: 4.79, emoji: "🥐", bg: "#FFF3B0", category: "breakfast", mealUpgrade: 3.3, upgradeOptions: [{ extraCharge: 3.3, savingsLabel: 1.75, linkedItems: [{ itemSlug: "br5" }, { itemSlug: "d5" }] }] },
  { slug: "br3", name: "Pancakes", description: "Three fluffy pancakes with syrup & butter", price: 4.49, emoji: "🥞", bg: "#FFE3B3", category: "breakfast" },
  { slug: "br4", name: "Breakfast Burrito", description: "Scrambled egg, sausage, peppers, cheese", price: 5.29, emoji: "🌯", bg: "#FFD9D1", category: "breakfast" },
  { slug: "br5", name: "Hash Browns", description: "Golden crispy", price: 2.29, emoji: "🥔", bg: "#FFE3B3", category: "breakfast" },

  { slug: "s1", name: "Golden Fries", description: "Sea-salted, crispy, hot", price: 3.29, emoji: "🍟", bg: "#FFF3B0", category: "sides", badge: "POPULAR", sizes: SIZES },
  { slug: "s2", name: "Sweet Potato Fries", description: "With maple dipping sauce", price: 3.99, emoji: "🍠", bg: "#FFD9A0", category: "sides", sizes: SIZES },
  { slug: "s3", name: "Poutine", description: "Fries, cheese curds, rich gravy", price: 5.99, emoji: "🍟", bg: "#E8DCC4", category: "sides", badge: "NEW", sizes: SIZES },
  { slug: "s4", name: "Onion Rings", description: "Beer-battered, house dip", price: 3.79, emoji: "🧅", bg: "#FFE3B3", category: "sides" },
  { slug: "s5", name: "Mozzarella Sticks", description: "5-piece with marinara", price: 4.49, emoji: "🧀", bg: "#FFF3B0", category: "sides" },
  { slug: "s6", name: "Side Salad", description: "Mixed greens, tomato, cucumber, ranch", price: 3.99, emoji: "🥗", bg: "#D9EBC7", category: "sides" },

  { slug: "d1", name: "Fountain Drink", description: "Cola, diet cola, lemon-lime, root beer", price: 2.49, emoji: "🥤", bg: "#D1E4F5", category: "drinks", sizes: SIZES },
  { slug: "d2", name: "Iced Coffee", description: "Cold brew, choice of milk", price: 2.99, emoji: "🧋", bg: "#E8DCC4", category: "drinks", sizes: SIZES },
  { slug: "d3", name: "Vanilla Milkshake", description: "Thick, creamy, real vanilla", price: 3.99, emoji: "🥛", bg: "#FFF3B0", category: "drinks", badge: "POPULAR", sizes: SIZES },
  { slug: "d4", name: "Chocolate Milkshake", description: "Rich cocoa, whipped cream", price: 3.99, emoji: "🍫", bg: "#E8DCC4", category: "drinks", sizes: SIZES },
  { slug: "d5", name: "Orange Juice", description: "100% fresh squeezed", price: 2.79, emoji: "🍊", bg: "#FFD9A0", category: "drinks" },
  { slug: "d6", name: "Bottled Water", description: "Still, 500ml", price: 1.99, emoji: "💧", bg: "#D1E4F5", category: "drinks" },

  { slug: "de1", name: "Soft Serve Cone", description: "Vanilla, chocolate, or twist", price: 1.99, emoji: "🍦", bg: "#FFF3B0", category: "desserts", badge: "POPULAR" },
  { slug: "de2", name: "Hot Fudge Sundae", description: "Soft serve, hot fudge, peanuts", price: 3.49, emoji: "🍨", bg: "#E8DCC4", category: "desserts" },
  { slug: "de3", name: "Apple Pie", description: "Warm, flaky crust, caramel", price: 2.49, emoji: "🥧", bg: "#FFE3B3", category: "desserts" },
  { slug: "de4", name: "Chocolate Chip Cookie", description: "Warm, gooey, 3-pack", price: 2.29, emoji: "🍪", bg: "#FFE3B3", category: "desserts" },
  { slug: "de5", name: "Cookie Blizzard", description: "Soft serve blended with cookie pieces", price: 3.99, emoji: "🍦", bg: "#E8DCC4", category: "desserts", badge: "NEW" },

  { slug: "k1", name: "Kids Nuggets Meal", description: "4 nuggets, small fries, juice, toy", price: 5.99, emoji: "🧸", bg: "#FFD9D1", category: "kids" },
  { slug: "k2", name: "Kids Cheeseburger Meal", description: "Kids burger, small fries, juice, toy", price: 5.99, emoji: "🎈", bg: "#FFF3B0", category: "kids" },
  { slug: "k3", name: "Kids Grilled Cheese", description: "Grilled cheese, apple slices, juice", price: 4.99, emoji: "🧀", bg: "#FFE3B3", category: "kids" },
];

async function main() {
  console.log("Seeding Rushbite menu…");

  const existingMenuItemCount = await prisma.menuItem.count();
  if (existingMenuItemCount > 0) {
    console.log(
      `Skipped sample seed because the menu already has ${existingMenuItemCount} item${existingMenuItemCount === 1 ? "" : "s"}.`
    );
    console.log(
      "This seed now only populates an empty database so admin edits are preserved."
    );
    return;
  }

  const catBySlug = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const created = await prisma.category.upsert({
      where: {
        outletId_slug: {
          outletId: DEFAULT_OUTLET_ID,
          slug: c.slug,
        },
      },
      update: {
        name: c.name,
        icon: c.icon,
        sortOrder: i,
        isActive: true,
      },
      create: {
        outletId: DEFAULT_OUTLET_ID,
        slug: c.slug,
        name: c.name,
        icon: c.icon,
        sortOrder: i,
      },
    });
    catBySlug.set(c.slug, created.id);
  }

  const createdItems = new Map<
    string,
    {
      id: string;
      name: string;
      sizesByKey: Map<string, { id: string; name: string }>;
    }
  >();

  for (const [i, it] of ITEMS.entries()) {
    const categoryId = catBySlug.get(it.category);
    if (!categoryId) throw new Error(`Unknown category: ${it.category}`);
    const created = await prisma.menuItem.create({
      include: {
        sizes: true,
      },
      data: {
        categoryId,
        outletId: DEFAULT_OUTLET_ID,
        comboNum: it.comboNum ?? null,
        name: it.name,
        description: it.description,
        price: new Prisma.Decimal(it.price),
        emoji: it.emoji,
        bgColor: it.bg,
        badge: it.badge ?? null,
        mealUpgrade: it.mealUpgrade != null ? new Prisma.Decimal(it.mealUpgrade) : null,
        mealSavings: it.mealSavings != null ? new Prisma.Decimal(it.mealSavings) : null,
        bundleSavings:
          it.bundleSavings != null ? new Prisma.Decimal(it.bundleSavings) : null,
        sortOrder: i,
        sizes: it.sizes?.length
          ? {
              create: it.sizes.map((s, idx) => ({
                name: s.name,
                priceDelta: new Prisma.Decimal(s.price),
                sortOrder: idx,
              })),
            }
          : undefined,
        addons: it.addons?.length
          ? {
              create: it.addons.map((a, idx) => ({
                name: a.name,
                priceDelta: new Prisma.Decimal(a.price),
                sortOrder: idx,
              })),
            }
          : undefined,
      },
    });

    createdItems.set(it.slug, {
      id: created.id,
      name: created.name,
      sizesByKey: new Map(
        created.sizes.map((size) => [size.name.toLowerCase(), { id: size.id, name: size.name }])
      ),
    });
  }

  for (const it of ITEMS) {
    if (!it.upgradeOptions?.length) continue;
    const parent = createdItems.get(it.slug);
    if (!parent) {
      throw new Error(`Missing parent menu item for upgrade seed: ${it.slug}`);
    }

    for (const [upgradeIndex, option] of it.upgradeOptions.entries()) {
      await prisma.upgradeOption.create({
        data: {
          itemId: parent.id,
          customTitle: option.customTitle ?? null,
          extraCharge: new Prisma.Decimal(option.extraCharge),
          savingsLabel:
            option.savingsLabel != null
              ? new Prisma.Decimal(option.savingsLabel)
              : null,
          sortOrder: upgradeIndex,
          linkedItems: {
            create: option.linkedItems.map((link, linkIndex) => {
              const linkedItem = createdItems.get(link.itemSlug);
              if (!linkedItem) {
                throw new Error(
                  `Missing linked menu item for upgrade seed: ${it.slug} -> ${link.itemSlug}`
                );
              }

              const linkedSize = link.sizeId
                ? linkedItem.sizesByKey.get(
                    link.sizeId === "sm"
                      ? "small"
                      : link.sizeId === "md"
                      ? "medium"
                      : link.sizeId === "lg"
                      ? "large"
                      : link.sizeId.toLowerCase()
                  ) ?? null
                : null;

              if (link.sizeId && linkedSize == null) {
                throw new Error(
                  `Missing linked size for upgrade seed: ${it.slug} -> ${link.itemSlug} (${link.sizeId})`
                );
              }

              return {
                linkedMenuItemId: linkedItem.id,
                linkedSizeId: linkedSize?.id ?? null,
                itemNameSnapshot: linkedItem.name,
                sizeNameSnapshot: linkedSize?.name ?? null,
                sortOrder: linkIndex,
              };
            }),
          },
        },
      });
    }
  }

  const c = await prisma.menuItem.count();
  const u = await prisma.upgradeOption.count();
  console.log(
    `Seeded ${CATEGORIES.length} categories, ${c} menu items, and ${u} upgrade option${u === 1 ? "" : "s"}.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
