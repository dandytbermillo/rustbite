/* eslint-disable no-console */
import { Prisma } from "@prisma/client";
import { createRequire } from "module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { prisma } from "@/lib/db";
import { DEVICE_SESSION_COOKIE, type DeviceRole } from "@/lib/device-auth";
import { formatDisplayOrderNumber, getBusinessDate } from "@/lib/outlets";

type JsonObject = Record<string, unknown>;

const runId = `cash-flow-${Date.now()}`;
const outletId = "cafeteria";
const categorySlug = `test-${runId}`;
const require = createRequire(import.meta.url);

let categoryId: string | null = null;
let itemId: string | null = null;
let paymentSessionId: string | null = null;
let orderId: string | null = null;
let historicalOrderId: string | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deviceCookie(role: DeviceRole) {
  return `${DEVICE_SESSION_COOKIE}=legacy:${role}:local-${role}-key`;
}

function request(
  role: DeviceRole,
  method: string,
  url: string,
  body?: JsonObject
) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: deviceCookie(role),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function ensureCafeteriaOutlet() {
  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: {
      id: "site",
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });

  await prisma.outlet.upsert({
    where: { id: outletId },
    update: { isActive: true },
    create: {
      id: outletId,
      siteId: "site",
      name: "Cafeteria",
      slug: "cafeteria",
      orderPrefix: "C",
      isActive: true,
    },
  });
}

async function createTemporaryMenuItem() {
  const category = await prisma.category.create({
    data: {
      outletId,
      slug: categorySlug,
      name: `Cash Flow Test ${runId}`,
      icon: "T",
      isActive: true,
      sortOrder: 9999,
    },
  });
  categoryId = category.id;

  const item = await prisma.menuItem.create({
    data: {
      categoryId: category.id,
      outletId,
      name: `Cash Flow Burger ${runId}`,
      description: "Temporary item for cash order flow testing",
      price: new Prisma.Decimal("10.00"),
      emoji: "T",
      bgColor: "#FFF3B0",
      isActive: true,
      isOutOfStock: false,
      sortOrder: 9999,
    },
  });
  itemId = item.id;
}

async function createHistoricalDuplicateDisplayNumber() {
  const outlet = await prisma.outlet.findUniqueOrThrow({
    where: { id: outletId },
    select: {
      orderPrefix: true,
      site: { select: { timezone: true } },
    },
  });
  const businessDate = getBusinessDate(new Date(), {
    timeZone: outlet.site.timezone,
  });
  const sequence = await prisma.outletDailyOrderSequence.findUnique({
    where: { outletId_businessDate: { outletId, businessDate } },
    select: { nextSequence: true },
  });
  const upcomingSequenceNumber = sequence?.nextSequence ?? 1;
  const displayOrderNumber = formatDisplayOrderNumber(
    outlet.orderPrefix,
    upcomingSequenceNumber
  );

  const historical = await prisma.order.create({
    data: {
      orderNumber: displayOrderNumber,
      outletId,
      businessDate: new Date("2000-01-01T00:00:00.000Z"),
      sequenceNumber: upcomingSequenceNumber,
      displayOrderNumber,
      kioskId: `historical-${runId}`,
      orderType: "TAKEOUT",
      status: "COMPLETED",
      subtotal: new Prisma.Decimal("0.00"),
      gst: new Prisma.Decimal("0.00"),
      total: new Prisma.Decimal("0.00"),
      paymentMethod: "CASH",
      paymentProvider: "COUNTER",
      paymentStatus: "CAPTURED",
    },
  });
  historicalOrderId = historical.id;
}

async function cleanup() {
  if (paymentSessionId) {
    await prisma.paymentTransaction.deleteMany({
      where: { id: paymentSessionId },
    });
  }
  if (orderId) {
    await prisma.order.deleteMany({ where: { id: orderId } });
  }
  if (historicalOrderId) {
    await prisma.order.deleteMany({ where: { id: historicalOrderId } });
  }
  if (itemId) {
    await prisma.menuItem.deleteMany({ where: { id: itemId } });
  }
  if (categoryId) {
    await prisma.category.deleteMany({ where: { id: categoryId } });
  }
}

async function main() {
  process.env.ALLOW_LEGACY_DEVICE_AUTH = "1";
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
    children: [],
    paths: [],
  } as unknown as NodeJS.Module;

  const paymentSessionsRoute = await import("@/app/api/payments/sessions/route");
  const ordersRoute = await import("@/app/api/orders/route");
  const orderDetailRoute = await import("@/app/api/orders/[id]/route");

  await ensureCafeteriaOutlet();
  await createTemporaryMenuItem();
  await createHistoricalDuplicateDisplayNumber();
  assert(itemId, "Temporary menu item was not created.");

  const paymentResponse = await paymentSessionsRoute.POST(
    request("kiosk", "POST", "http://localhost/api/payments/sessions", {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal: 21,
      items: [{ menuItemId: itemId, qty: 2 }],
    })
  );
  const paymentJson = await json<{
    id?: string;
    status?: string;
    provider?: string;
    paymentMethod?: string;
    total?: number;
    error?: string;
  }>(paymentResponse);

  assert(
    paymentResponse.status === 201,
    `Expected payment session 201, got ${paymentResponse.status}: ${paymentJson.error ?? ""}`
  );
  assert(paymentJson.id, "Payment session id was not returned.");
  assert(paymentJson.status === "PENDING_COUNTER_PAYMENT", "Cash session should wait for counter payment.");
  assert(paymentJson.provider === "COUNTER", "Cash session should use the COUNTER provider.");
  assert(paymentJson.paymentMethod === "CASH", "Cash session should use CASH payment method.");
  assert(paymentJson.total === 21, "Cash session total should be 21.00.");
  paymentSessionId = paymentJson.id;

  const finalize = () =>
    ordersRoute.POST(
      request("kiosk", "POST", "http://localhost/api/orders", {
        paymentSessionId,
      })
    );

  const [firstOrderResponse, secondOrderResponse] = await Promise.all([
    finalize(),
    finalize(),
  ]);
  const firstOrderJson = await json<{
    id?: string;
    orderNumber?: string;
    status?: string;
    total?: number;
    error?: string;
  }>(firstOrderResponse);
  const secondOrderJson = await json<{
    id?: string;
    orderNumber?: string;
    status?: string;
    total?: number;
    error?: string;
  }>(secondOrderResponse);

  assert(
    [200, 201].includes(firstOrderResponse.status),
    `Expected first order response 200/201, got ${firstOrderResponse.status}: ${firstOrderJson.error ?? ""}`
  );
  assert(
    [200, 201].includes(secondOrderResponse.status),
    `Expected second order response 200/201, got ${secondOrderResponse.status}: ${secondOrderJson.error ?? ""}`
  );
  assert(firstOrderJson.id, "First order response did not include an id.");
  assert(secondOrderJson.id, "Second order response did not include an id.");
  assert(
    firstOrderJson.id === secondOrderJson.id,
    "Duplicate order finalization returned different order ids."
  );
  assert(
    firstOrderJson.status === "AWAITING_COUNTER_PAYMENT" &&
      secondOrderJson.status === "AWAITING_COUNTER_PAYMENT",
    "Cash order should start in AWAITING_COUNTER_PAYMENT."
  );
  assert(firstOrderJson.total === 21, "Finalized order total should be 21.00.");
  orderId = firstOrderJson.id;

  const linkedOrders = await prisma.order.count({
    where: {
      paymentTransaction: { id: paymentSessionId },
    },
  });
  assert(linkedOrders === 1, "Payment session should be linked to exactly one order.");

  const transactionAfterFinalize = await prisma.paymentTransaction.findUnique({
    where: { id: paymentSessionId },
    select: {
      orderId: true,
      finalizedOrderId: true,
      finalizedAt: true,
      completedAt: true,
      status: true,
    },
  });
  assert(transactionAfterFinalize, "Payment transaction disappeared.");
  assert(transactionAfterFinalize.orderId === orderId, "Transaction orderId does not match the order.");
  assert(
    transactionAfterFinalize.finalizedOrderId === orderId,
    "Transaction finalizedOrderId does not match the order."
  );
  assert(transactionAfterFinalize.finalizedAt, "Transaction finalizedAt was not set.");
  assert(
    transactionAfterFinalize.status === "PENDING_COUNTER_PAYMENT",
    "Transaction should still wait for counter payment before release."
  );
  assert(
    transactionAfterFinalize.completedAt == null,
    "Counter payment should not be completed before staff marks cash received."
  );

  const paidResponse = await orderDetailRoute.PATCH(
    request("counter", "PATCH", `http://localhost/api/orders/${orderId}`, {
      status: "PAID",
    }),
    { params: Promise.resolve({ id: orderId }) }
  );
  const paidJson = await json<{
    id?: string;
    status?: string;
    paymentStatus?: string;
    error?: string;
  }>(paidResponse);
  assert(
    paidResponse.status === 200,
    `Expected counter release 200, got ${paidResponse.status}: ${paidJson.error ?? ""}`
  );
  assert(paidJson.status === "PAID", "Counter release should mark the order PAID.");
  assert(paidJson.paymentStatus === "CAPTURED", "Counter release should mark payment CAPTURED.");

  const kitchenFeedResponse = await ordersRoute.GET(
    request(
      "kitchen",
      "GET",
      "http://localhost/api/orders?status=PAID,IN_KITCHEN"
    )
  );
  const kitchenFeedJson = await json<{
    orders?: Array<{ id: string; status: string; orderNumber: string }>;
    error?: string;
  }>(kitchenFeedResponse);
  assert(
    kitchenFeedResponse.status === 200,
    `Expected kitchen feed 200, got ${kitchenFeedResponse.status}: ${kitchenFeedJson.error ?? ""}`
  );
  assert(
    kitchenFeedJson.orders?.some(
      (order) => order.id === orderId && order.status === "PAID"
    ),
    "Paid cash order should appear in the kitchen feed."
  );

  const transactionAfterCounter = await prisma.paymentTransaction.findUnique({
    where: { id: paymentSessionId },
    select: { status: true, completedAt: true },
  });
  assert(transactionAfterCounter?.status === "CAPTURED", "Transaction should be captured after counter release.");
  assert(transactionAfterCounter.completedAt, "Transaction completedAt should be set after counter release.");

  console.log(
    `Cash order flow test passed: ${firstOrderJson.orderNumber} (${orderId})`
  );
}

main()
  .catch((err) => {
    console.error("Cash order flow test failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((err) => {
      console.error("Cash order flow cleanup failed.");
      console.error(err);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
