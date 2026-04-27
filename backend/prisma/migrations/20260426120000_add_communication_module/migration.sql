-- CreateTable: company_settings
CREATE TABLE "company_settings" (
    "companyId"      TEXT NOT NULL PRIMARY KEY,
    "smtpFrom"       TEXT,
    "whatsappFrom"   TEXT,
    "defaultCCEmail" TEXT,
    "defaultCCPhone" TEXT
);

-- CreateTable: message_templates
CREATE TABLE "message_templates" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "companyId"       TEXT NOT NULL,
    "code"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "channel"         TEXT NOT NULL DEFAULT 'BOTH',
    "subjectTemplate" TEXT,
    "bodyTemplate"    TEXT NOT NULL,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "isDefault"       BOOLEAN NOT NULL DEFAULT false,
    "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME NOT NULL
);

CREATE UNIQUE INDEX "message_templates_companyId_code_key" ON "message_templates"("companyId", "code");
CREATE INDEX "message_templates_companyId_idx"  ON "message_templates"("companyId");
CREATE INDEX "message_templates_isActive_idx"   ON "message_templates"("isActive");

-- CreateTable: communication_jobs
CREATE TABLE "communication_jobs" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "companyId"    TEXT NOT NULL,
    "bundleId"     TEXT,
    "channel"      TEXT NOT NULL,
    "recipients"   TEXT NOT NULL,
    "templateId"   TEXT,
    "templateVars" TEXT NOT NULL DEFAULT '{}',
    "status"       TEXT NOT NULL DEFAULT 'QUEUED',
    "priority"     TEXT NOT NULL DEFAULT 'NORMAL',
    "scheduledAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt"  DATETIME,
    "retryCount"   INTEGER NOT NULL DEFAULT 0,
    "maxRetries"   INTEGER NOT NULL DEFAULT 3,
    "lastError"    TEXT,
    "notes"        TEXT,
    "createdBy"    TEXT,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL,
    CONSTRAINT "communication_jobs_templateId_fkey"
        FOREIGN KEY ("templateId") REFERENCES "message_templates"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "communication_jobs_companyId_idx"   ON "communication_jobs"("companyId");
CREATE INDEX "communication_jobs_status_idx"      ON "communication_jobs"("status");
CREATE INDEX "communication_jobs_scheduledAt_idx" ON "communication_jobs"("scheduledAt");
CREATE INDEX "communication_jobs_bundleId_idx"    ON "communication_jobs"("bundleId");

-- CreateTable: communication_messages
CREATE TABLE "communication_messages" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "jobId"           TEXT NOT NULL,
    "channel"         TEXT NOT NULL,
    "recipient"       TEXT NOT NULL,
    "recipientName"   TEXT,
    "isCC"            BOOLEAN NOT NULL DEFAULT false,
    "renderedSubject" TEXT,
    "renderedBody"    TEXT NOT NULL,
    "mediaUrls"       TEXT NOT NULL DEFAULT '[]',
    "status"          TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount"    INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt"   DATETIME,
    "sentAt"          DATETIME,
    "errorCode"       TEXT,
    "errorMsg"        TEXT,
    "externalId"      TEXT,
    "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME NOT NULL,
    CONSTRAINT "communication_messages_jobId_fkey"
        FOREIGN KEY ("jobId") REFERENCES "communication_jobs"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "communication_messages_jobId_idx"     ON "communication_messages"("jobId");
CREATE INDEX "communication_messages_status_idx"    ON "communication_messages"("status");
CREATE INDEX "communication_messages_recipient_idx" ON "communication_messages"("recipient");
