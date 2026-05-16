import "server-only";
import { prisma } from "@/lib/db";

const SINGLETON_ID = "singleton";

export type AppSettings = {
  storeName: string;
  storeLocation: string;
  gstRate: number;
  dealDefaultDiscountPct: number | null;
};

export type AppSettingsInput = {
  storeName: string;
  storeLocation: string;
  gstRate: number;
  dealDefaultDiscountPct: number | null;
};

function envDefaults(): AppSettings {
  const envGst = Number(process.env.GST_RATE);
  return {
    storeName: process.env.NEXT_PUBLIC_STORE_NAME ?? "Rushbite",
    storeLocation: process.env.NEXT_PUBLIC_STORE_LOCATION ?? "",
    gstRate: Number.isFinite(envGst) && envGst >= 0 ? envGst : 0.05,
    dealDefaultDiscountPct: null,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (!row) return envDefaults();
    return {
      storeName: row.storeName,
      storeLocation: row.storeLocation,
      gstRate: Number(row.gstRate),
      dealDefaultDiscountPct:
        row.dealDefaultDiscountPct != null
          ? Number(row.dealDefaultDiscountPct)
          : null,
    };
  } catch {
    return envDefaults();
  }
}

export async function saveAppSettings(
  input: AppSettingsInput
): Promise<AppSettings> {
  const row = await prisma.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      storeName: input.storeName,
      storeLocation: input.storeLocation,
      gstRate: input.gstRate,
      dealDefaultDiscountPct: input.dealDefaultDiscountPct,
    },
    update: {
      storeName: input.storeName,
      storeLocation: input.storeLocation,
      gstRate: input.gstRate,
      dealDefaultDiscountPct: input.dealDefaultDiscountPct,
    },
  });
  return {
    storeName: row.storeName,
    storeLocation: row.storeLocation,
    gstRate: Number(row.gstRate),
    dealDefaultDiscountPct:
      row.dealDefaultDiscountPct != null
        ? Number(row.dealDefaultDiscountPct)
        : null,
  };
}
