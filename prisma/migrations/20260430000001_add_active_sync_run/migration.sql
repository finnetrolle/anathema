-- AlterTable
ALTER TABLE "JiraConnection" ADD COLUMN "activeSyncRunId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "JiraConnection_activeSyncRunId_key" ON "JiraConnection"("activeSyncRunId");

-- AddForeignKey
ALTER TABLE "JiraConnection" ADD CONSTRAINT "JiraConnection_activeSyncRunId_fkey" FOREIGN KEY ("activeSyncRunId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
