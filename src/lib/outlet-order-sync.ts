import { Prisma } from "@prisma/client";

type OutletOrderVersionClient = Pick<
  Prisma.TransactionClient,
  "outletOrderVersion"
>;

export type OutletOrderVersionDTO = {
  outletId: string;
  revision: number;
  updatedAt: string;
};

export async function getOutletOrderVersion(
  client: OutletOrderVersionClient,
  outletId: string
): Promise<OutletOrderVersionDTO> {
  const row = await client.outletOrderVersion.findUnique({
    where: { outletId },
    select: { outletId: true, revision: true, updatedAt: true },
  });

  if (!row) {
    return {
      outletId,
      revision: 1,
      updatedAt: new Date(0).toISOString(),
    };
  }

  return {
    outletId: row.outletId,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function bumpOutletOrderVersion(
  client: OutletOrderVersionClient,
  outletId: string
): Promise<OutletOrderVersionDTO> {
  const row = await client.outletOrderVersion.upsert({
    where: { outletId },
    update: { revision: { increment: 1 } },
    create: { outletId, revision: 2 },
    select: { outletId: true, revision: true, updatedAt: true },
  });

  return {
    outletId: row.outletId,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}
