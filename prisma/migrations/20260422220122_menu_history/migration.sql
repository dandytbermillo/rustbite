-- CreateTable
CREATE TABLE "MenuAuditLog" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "actorType" TEXT NOT NULL,
    "actorIdentity" TEXT,
    "beforePayload" JSONB,
    "afterPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuRevision" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorIdentity" TEXT,
    "snapshot" JSONB NOT NULL,
    "sourceRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenuAuditLog_createdAt_idx" ON "MenuAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "MenuAuditLog_targetType_targetId_idx" ON "MenuAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "MenuRevision_createdAt_idx" ON "MenuRevision"("createdAt");

-- CreateIndex
CREATE INDEX "MenuRevision_sourceRevisionId_idx" ON "MenuRevision"("sourceRevisionId");
