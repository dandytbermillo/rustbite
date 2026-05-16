import { Prisma } from "@prisma/client";

type OutletMenuVersionClient = Pick<Prisma.TransactionClient, "outletMenuVersion">;

export type OutletMenuVersionDTO = {
  outletId: string;
  revision: number;
  updatedAt: string;
};

export async function getOutletMenuVersion(
  client: OutletMenuVersionClient,
  outletId: string
): Promise<OutletMenuVersionDTO> {
  const row = await client.outletMenuVersion.findUnique({
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

export async function bumpOutletMenuVersion(
  client: OutletMenuVersionClient,
  outletId: string
): Promise<OutletMenuVersionDTO> {
  const row = await client.outletMenuVersion.upsert({
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
