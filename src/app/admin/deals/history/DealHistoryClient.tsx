"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import DealHistoryBrowser from "@/components/admin/deals/DealHistoryBrowser";
import type { DealHistoryEntry } from "@/lib/deal-history";

const DEAL_REUSE_STORAGE_KEY = "rushbite:reuse-deal-snapshot";

export default function DealHistoryClient({
  entries,
  serverNowIso,
  canWriteMenu,
}: {
  entries: DealHistoryEntry[];
  serverNowIso: string;
  canWriteMenu: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const useAgain = (entry: DealHistoryEntry) => {
    sessionStorage.setItem(
      DEAL_REUSE_STORAGE_KEY,
      JSON.stringify({
        sourceHistoryId: entry.historyId,
        snapshot: entry.dealSnapshot,
      }),
    );
    startTransition(() => router.push("/admin/menu"));
  };

  return (
    <DealHistoryBrowser
      entries={entries}
      serverNowIso={serverNowIso}
      canWriteMenu={canWriteMenu}
      onUseAgain={useAgain}
    />
  );
}
