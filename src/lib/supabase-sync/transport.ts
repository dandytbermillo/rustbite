import type { SyncOutbox } from "@prisma/client";

export type SyncOutboxSendResult =
  | { status: "sent" }
  | { status: "duplicate" }
  | { status: "failed"; error: string }
  | { status: "timeout"; error?: string };

export type SyncOutboxTransport = {
  send(row: SyncOutbox): Promise<SyncOutboxSendResult>;
};
