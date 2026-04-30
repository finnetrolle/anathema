-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DailyBriefScopeType" AS ENUM ('TEAM', 'PERSON', 'PROJECT');

-- CreateEnum
CREATE TYPE "DailyBriefRunStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DailyBriefItemType" AS ENUM ('COMPLETED', 'STARTED', 'STALE_IN_PROGRESS', 'OVERDUE', 'MISSING_DUE_DATE', 'MISSING_ESTIMATE', 'NO_CODE_ACTIVITY', 'OWNERSHIP_CHANGED', 'DONE_WITHOUT_PR', 'REOPENED');

-- CreateEnum
CREATE TYPE "DailyBriefImportance" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TimelineMarkerKind" AS ENUM ('DONE', 'DUE', 'NONE');

-- CreateEnum
CREATE TYPE "RiskEntityType" AS ENUM ('PROJECT', 'EPIC', 'ISSUE', 'ASSIGNEE', 'COMPONENT');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskReasonCode" AS ENUM ('OVERDUE', 'AGING_WIP', 'MISSING_ESTIMATE', 'MISSING_DUE_DATE', 'NO_DEV_ACTIVITY', 'ASSIGNEE_CHURN', 'REOPENED', 'HIGH_RISK_CHILDREN', 'SPREAD_RISK', 'CONCENTRATION_RISK');

-- CreateTable
CREATE TABLE "JiraConnection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "defaultJql" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "workflowRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JiraProject" (
    "id" TEXT NOT NULL,
    "jiraConnectionId" TEXT NOT NULL,
    "jiraProjectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "jiraConnectionId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "requestedJql" TEXT,
    "issuesFetched" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedJiraProject" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "jiraProjectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagedJiraProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedAssignee" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "jiraAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagedAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedEpic" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "stagedProjectId" TEXT NOT NULL,
    "jiraEpicId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rank" TEXT,
    "jiraUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagedEpic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedIssue" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "stagedProjectId" TEXT NOT NULL,
    "stagedEpicId" TEXT,
    "stagedAssigneeId" TEXT,
    "jiraIssueId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "priority" TEXT,
    "dueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "markerAt" TIMESTAMP(3),
    "markerKind" "TimelineMarkerKind" NOT NULL DEFAULT 'NONE',
    "jiraCreatedAt" TIMESTAMP(3),
    "jiraUpdatedAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagedIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedIssueStatusHistory" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "stagedIssueId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StagedIssueStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignee" (
    "id" TEXT NOT NULL,
    "jiraConnectionId" TEXT,
    "jiraAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Epic" (
    "id" TEXT NOT NULL,
    "jiraProjectId" TEXT NOT NULL,
    "jiraEpicId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rank" TEXT,
    "jiraUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Epic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "jiraProjectId" TEXT NOT NULL,
    "epicId" TEXT,
    "assigneeId" TEXT,
    "jiraIssueId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "priority" TEXT,
    "dueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "markerAt" TIMESTAMP(3),
    "markerKind" "TimelineMarkerKind" NOT NULL DEFAULT 'NONE',
    "jiraCreatedAt" TIMESTAMP(3),
    "jiraUpdatedAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueStatusHistory" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyBriefRun" (
    "id" TEXT NOT NULL,
    "jiraConnectionId" TEXT NOT NULL,
    "syncRunId" TEXT,
    "generatedForDate" TIMESTAMP(3) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "scopeType" "DailyBriefScopeType" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "scopeLabel" TEXT NOT NULL,
    "status" "DailyBriefRunStatus" NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyBriefRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyBriefItem" (
    "id" TEXT NOT NULL,
    "dailyBriefRunId" TEXT NOT NULL,
    "issueJiraId" TEXT,
    "issueKey" TEXT NOT NULL,
    "issueSummary" TEXT NOT NULL,
    "issueUrl" TEXT,
    "assigneeName" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "epicKey" TEXT,
    "epicSummary" TEXT,
    "componentName" TEXT NOT NULL,
    "itemType" "DailyBriefItemType" NOT NULL,
    "importance" "DailyBriefImportance" NOT NULL,
    "headline" TEXT NOT NULL,
    "detailsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyBriefItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskSnapshot" (
    "id" TEXT NOT NULL,
    "jiraConnectionId" TEXT NOT NULL,
    "jiraProjectId" TEXT,
    "epicId" TEXT,
    "issueId" TEXT,
    "entityType" "RiskEntityType" NOT NULL,
    "entityKey" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskReason" (
    "id" TEXT NOT NULL,
    "riskSnapshotId" TEXT NOT NULL,
    "reasonCode" "RiskReasonCode" NOT NULL,
    "weight" INTEGER NOT NULL,
    "detailsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskThresholdConfig" (
    "jiraConnectionId" TEXT NOT NULL,
    "agingDaysWarning" INTEGER NOT NULL DEFAULT 5,
    "agingDaysCritical" INTEGER NOT NULL DEFAULT 10,
    "reassignmentsThreshold" INTEGER NOT NULL DEFAULT 2,
    "staleDevActivityDays" INTEGER NOT NULL DEFAULT 3,
    "epicHighRiskIssueCount" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskThresholdConfig_pkey" PRIMARY KEY ("jiraConnectionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "JiraConnection_baseUrl_key" ON "JiraConnection"("baseUrl");

-- CreateIndex
CREATE UNIQUE INDEX "JiraProject_jiraConnectionId_jiraProjectId_key" ON "JiraProject"("jiraConnectionId", "jiraProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "JiraProject_jiraConnectionId_key_key" ON "JiraProject"("jiraConnectionId", "key");

-- CreateIndex
CREATE INDEX "StagedJiraProject_syncRunId_idx" ON "StagedJiraProject"("syncRunId");

-- CreateIndex
CREATE UNIQUE INDEX "StagedJiraProject_syncRunId_jiraProjectId_key" ON "StagedJiraProject"("syncRunId", "jiraProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "StagedJiraProject_syncRunId_key_key" ON "StagedJiraProject"("syncRunId", "key");

-- CreateIndex
CREATE INDEX "StagedAssignee_syncRunId_idx" ON "StagedAssignee"("syncRunId");

-- CreateIndex
CREATE UNIQUE INDEX "StagedAssignee_syncRunId_jiraAccountId_key" ON "StagedAssignee"("syncRunId", "jiraAccountId");

-- CreateIndex
CREATE INDEX "StagedEpic_syncRunId_stagedProjectId_idx" ON "StagedEpic"("syncRunId", "stagedProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "StagedEpic_syncRunId_stagedProjectId_jiraEpicId_key" ON "StagedEpic"("syncRunId", "stagedProjectId", "jiraEpicId");

-- CreateIndex
CREATE UNIQUE INDEX "StagedEpic_syncRunId_stagedProjectId_key_key" ON "StagedEpic"("syncRunId", "stagedProjectId", "key");

-- CreateIndex
CREATE INDEX "StagedIssue_syncRunId_stagedEpicId_startedAt_markerAt_idx" ON "StagedIssue"("syncRunId", "stagedEpicId", "startedAt", "markerAt");

-- CreateIndex
CREATE INDEX "StagedIssue_syncRunId_stagedAssigneeId_markerAt_idx" ON "StagedIssue"("syncRunId", "stagedAssigneeId", "markerAt");

-- CreateIndex
CREATE UNIQUE INDEX "StagedIssue_syncRunId_stagedProjectId_jiraIssueId_key" ON "StagedIssue"("syncRunId", "stagedProjectId", "jiraIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "StagedIssue_syncRunId_stagedProjectId_key_key" ON "StagedIssue"("syncRunId", "stagedProjectId", "key");

-- CreateIndex
CREATE INDEX "StagedIssueStatusHistory_syncRunId_stagedIssueId_changedAt_idx" ON "StagedIssueStatusHistory"("syncRunId", "stagedIssueId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StagedIssueStatusHistory_syncRunId_stagedIssueId_changedAt__key" ON "StagedIssueStatusHistory"("syncRunId", "stagedIssueId", "changedAt", "toStatus");

-- CreateIndex
CREATE INDEX "Assignee_jiraConnectionId_idx" ON "Assignee"("jiraConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignee_jiraConnectionId_jiraAccountId_key" ON "Assignee"("jiraConnectionId", "jiraAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Epic_jiraProjectId_jiraEpicId_key" ON "Epic"("jiraProjectId", "jiraEpicId");

-- CreateIndex
CREATE UNIQUE INDEX "Epic_jiraProjectId_key_key" ON "Epic"("jiraProjectId", "key");

-- CreateIndex
CREATE INDEX "Issue_epicId_startedAt_markerAt_idx" ON "Issue"("epicId", "startedAt", "markerAt");

-- CreateIndex
CREATE INDEX "Issue_assigneeId_markerAt_idx" ON "Issue"("assigneeId", "markerAt");

-- CreateIndex
CREATE INDEX "Issue_jiraProjectId_issueType_startedAt_markerAt_idx" ON "Issue"("jiraProjectId", "issueType", "startedAt", "markerAt");

-- CreateIndex
CREATE INDEX "Issue_issueType_markerAt_idx" ON "Issue"("issueType", "markerAt");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_jiraProjectId_jiraIssueId_key" ON "Issue"("jiraProjectId", "jiraIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_jiraProjectId_key_key" ON "Issue"("jiraProjectId", "key");

-- CreateIndex
CREATE INDEX "IssueStatusHistory_issueId_changedAt_idx" ON "IssueStatusHistory"("issueId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssueStatusHistory_issueId_changedAt_toStatus_key" ON "IssueStatusHistory"("issueId", "changedAt", "toStatus");

-- CreateIndex
CREATE INDEX "DailyBriefRun_generatedForDate_scopeType_scopeKey_idx" ON "DailyBriefRun"("generatedForDate", "scopeType", "scopeKey");

-- CreateIndex
CREATE INDEX "DailyBriefRun_jiraConnectionId_generatedForDate_idx" ON "DailyBriefRun"("jiraConnectionId", "generatedForDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBriefRun_jiraConnectionId_generatedForDate_windowStart_key" ON "DailyBriefRun"("jiraConnectionId", "generatedForDate", "windowStart", "windowEnd", "scopeType", "scopeKey");

-- CreateIndex
CREATE INDEX "DailyBriefItem_dailyBriefRunId_itemType_importance_idx" ON "DailyBriefItem"("dailyBriefRunId", "itemType", "importance");

-- CreateIndex
CREATE INDEX "DailyBriefItem_issueKey_idx" ON "DailyBriefItem"("issueKey");

-- CreateIndex
CREATE INDEX "RiskSnapshot_jiraConnectionId_computedAt_idx" ON "RiskSnapshot"("jiraConnectionId", "computedAt");

-- CreateIndex
CREATE INDEX "RiskSnapshot_jiraConnectionId_entityType_entityKey_computed_idx" ON "RiskSnapshot"("jiraConnectionId", "entityType", "entityKey", "computedAt");

-- CreateIndex
CREATE INDEX "RiskSnapshot_jiraProjectId_entityType_computedAt_idx" ON "RiskSnapshot"("jiraProjectId", "entityType", "computedAt");

-- CreateIndex
CREATE INDEX "RiskSnapshot_entityType_riskLevel_computedAt_idx" ON "RiskSnapshot"("entityType", "riskLevel", "computedAt");

-- CreateIndex
CREATE INDEX "RiskReason_riskSnapshotId_reasonCode_idx" ON "RiskReason"("riskSnapshotId", "reasonCode");

-- AddForeignKey
ALTER TABLE "JiraProject" ADD CONSTRAINT "JiraProject_jiraConnectionId_fkey" FOREIGN KEY ("jiraConnectionId") REFERENCES "JiraConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_jiraConnectionId_fkey" FOREIGN KEY ("jiraConnectionId") REFERENCES "JiraConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedJiraProject" ADD CONSTRAINT "StagedJiraProject_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedAssignee" ADD CONSTRAINT "StagedAssignee_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedEpic" ADD CONSTRAINT "StagedEpic_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedEpic" ADD CONSTRAINT "StagedEpic_stagedProjectId_fkey" FOREIGN KEY ("stagedProjectId") REFERENCES "StagedJiraProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedIssue" ADD CONSTRAINT "StagedIssue_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedIssue" ADD CONSTRAINT "StagedIssue_stagedProjectId_fkey" FOREIGN KEY ("stagedProjectId") REFERENCES "StagedJiraProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedIssue" ADD CONSTRAINT "StagedIssue_stagedEpicId_fkey" FOREIGN KEY ("stagedEpicId") REFERENCES "StagedEpic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedIssue" ADD CONSTRAINT "StagedIssue_stagedAssigneeId_fkey" FOREIGN KEY ("stagedAssigneeId") REFERENCES "StagedAssignee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedIssueStatusHistory" ADD CONSTRAINT "StagedIssueStatusHistory_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedIssueStatusHistory" ADD CONSTRAINT "StagedIssueStatusHistory_stagedIssueId_fkey" FOREIGN KEY ("stagedIssueId") REFERENCES "StagedIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignee" ADD CONSTRAINT "Assignee_jiraConnectionId_fkey" FOREIGN KEY ("jiraConnectionId") REFERENCES "JiraConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_jiraProjectId_fkey" FOREIGN KEY ("jiraProjectId") REFERENCES "JiraProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_jiraProjectId_fkey" FOREIGN KEY ("jiraProjectId") REFERENCES "JiraProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Assignee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueStatusHistory" ADD CONSTRAINT "IssueStatusHistory_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueStatusHistory" ADD CONSTRAINT "IssueStatusHistory_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyBriefRun" ADD CONSTRAINT "DailyBriefRun_jiraConnectionId_fkey" FOREIGN KEY ("jiraConnectionId") REFERENCES "JiraConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyBriefRun" ADD CONSTRAINT "DailyBriefRun_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyBriefItem" ADD CONSTRAINT "DailyBriefItem_dailyBriefRunId_fkey" FOREIGN KEY ("dailyBriefRunId") REFERENCES "DailyBriefRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSnapshot" ADD CONSTRAINT "RiskSnapshot_jiraConnectionId_fkey" FOREIGN KEY ("jiraConnectionId") REFERENCES "JiraConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSnapshot" ADD CONSTRAINT "RiskSnapshot_jiraProjectId_fkey" FOREIGN KEY ("jiraProjectId") REFERENCES "JiraProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSnapshot" ADD CONSTRAINT "RiskSnapshot_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSnapshot" ADD CONSTRAINT "RiskSnapshot_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskReason" ADD CONSTRAINT "RiskReason_riskSnapshotId_fkey" FOREIGN KEY ("riskSnapshotId") REFERENCES "RiskSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskThresholdConfig" ADD CONSTRAINT "RiskThresholdConfig_jiraConnectionId_fkey" FOREIGN KEY ("jiraConnectionId") REFERENCES "JiraConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
