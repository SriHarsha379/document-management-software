-- CreateEnum
CREATE TYPE "BundleStatus" AS ENUM ('DRAFT', 'READY', 'SENT');

-- CreateEnum
CREATE TYPE "CommChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'BOTH');

-- CreateEnum
CREATE TYPE "DispatchChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_OCR', 'PENDING_REVIEW', 'REVIEWED', 'SAVED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE', 'EWAYBILL', 'RECEIVING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DriverDocType" AS ENUM ('LR', 'TOLL', 'WEIGHMENT_SLIP', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE', 'PARTY_ACK');

-- CreateEnum
CREATE TYPE "DriverUploadStatus" AS ENUM ('PENDING_OCR', 'PROCESSED', 'UNLINKED');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MsgStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('ACCOUNTS', 'PARTY', 'TRANSPORTER');

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_items" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bundle_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_jobs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bundleId" TEXT,
    "channel" "CommChannel" NOT NULL,
    "recipients" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVars" TEXT NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_messages" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipientName" TEXT,
    "isCC" BOOLEAN NOT NULL DEFAULT false,
    "renderedSubject" TEXT,
    "renderedBody" TEXT NOT NULL,
    "mediaUrls" TEXT NOT NULL DEFAULT '[]',
    "status" "MsgStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMsg" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "companyId" TEXT NOT NULL,
    "smtpFrom" TEXT,
    "whatsappFrom" TEXT,
    "defaultCCEmail" TEXT,
    "defaultCCPhone" TEXT,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "customer_portal_accesses" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "loginEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "customer_portal_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_logs" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "channel" "DispatchChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "ccRecipient" TEXT,
    "message" TEXT NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "errorMsg" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_bundles" (
    "id" TEXT NOT NULL,
    "recipientType" "RecipientType" NOT NULL,
    "status" "BundleStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_groups" (
    "id" TEXT NOT NULL,
    "vehicleNo" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_link_records" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lrId" TEXT NOT NULL,
    "matchedFields" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_link_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "originalFilename" TEXT NOT NULL,
    "rawFilePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupId" TEXT,
    "sourceDocumentId" TEXT,
    "pageNumber" INTEGER,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_upload_documents" (
    "id" TEXT NOT NULL,
    "docType" "DriverDocType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DriverUploadStatus" NOT NULL DEFAULT 'PENDING_OCR',
    "ocrText" TEXT,
    "ocrData" TEXT,
    "vehicleNumber" TEXT,
    "documentDate" TEXT,
    "linkedGroupId" TEXT,
    "tempDriverAccessId" TEXT NOT NULL,

    CONSTRAINT "driver_upload_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_data" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lrNo" TEXT,
    "invoiceNo" TEXT,
    "vehicleNo" TEXT,
    "quantity" TEXT,
    "date" TEXT,
    "partyNames" TEXT,
    "tollAmount" TEXT,
    "weightInfo" TEXT,
    "transporter" TEXT,
    "billToParty" TEXT,
    "shipToParty" TEXT,
    "principalCompany" TEXT,
    "branchName" TEXT,
    "loadingSlipNo" TEXT,
    "companyInvoiceNo" TEXT,
    "companyInvoiceDate" TEXT,
    "companyEwayBillNo" TEXT,
    "deliveryDestination" TEXT,
    "productName" TEXT,
    "transporterName" TEXT,
    "orderType" TEXT,
    "tptCode" TEXT,
    "quantityInMt" DOUBLE PRECISION,
    "quantityInBags" DOUBLE PRECISION,
    "driverName" TEXT,
    "driverCellNo" TEXT,
    "ewayBillDate" TEXT,
    "approvedDestination" TEXT,
    "orderNo" TEXT,
    "workingCenter" TEXT,
    "depotPlantCode" TEXT,
    "source" TEXT,
    "rawOcrResponse" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "ocrProcessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userReviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "userEdits" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extracted_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_profiles" (
    "id" TEXT NOT NULL,
    "profileKey" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "principalCompany" TEXT,
    "branchName" TEXT,
    "transporterName" TEXT,
    "profileData" TEXT NOT NULL,
    "samplesCount" INTEGER NOT NULL DEFAULT 1,
    "successfulSaves" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lrs" (
    "id" TEXT NOT NULL,
    "serialNo" INTEGER,
    "lrNo" TEXT NOT NULL,
    "lrDate" TEXT,
    "loadingSlipNo" TEXT,
    "companyInvoiceDate" TEXT,
    "companyInvoiceNo" TEXT,
    "companyEwayBillNo" TEXT,
    "principalCompany" TEXT,
    "billToParty" TEXT,
    "shipToParty" TEXT,
    "deliveryDestination" TEXT,
    "tpt" TEXT,
    "orderType" TEXT,
    "productName" TEXT,
    "vehicleNo" TEXT,
    "quantityInBags" DOUBLE PRECISION,
    "quantityInMt" DOUBLE PRECISION,
    "tollCharges" DOUBLE PRECISION,
    "weighmentCharges" DOUBLE PRECISION,
    "unloadingAtSite" DOUBLE PRECISION,
    "driverBhatta" DOUBLE PRECISION,
    "dayOpeningKm" DOUBLE PRECISION,
    "dayClosingKm" DOUBLE PRECISION,
    "totalRunningKm" DOUBLE PRECISION,
    "fuelPerKm" DOUBLE PRECISION,
    "fuelAmount" DOUBLE PRECISION,
    "grandTotal" DOUBLE PRECISION,
    "tptCode" TEXT,
    "transporterName" TEXT,
    "driverName" TEXT,
    "driverBillNo" TEXT,
    "billDate" TEXT,
    "billNo" TEXT,
    "billAmount" DOUBLE PRECISION,
    "invoiceNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "consignor" TEXT,
    "consignee" TEXT,
    "date" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "driverCellNo" TEXT,
    "ewayBillDate" TEXT,
    "approvedDestination" TEXT,
    "orderNo" TEXT,
    "workingCenter" TEXT,
    "depotPlantCode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'INTERNAL',

    CONSTRAINT "lrs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL DEFAULT 'BOTH',
    "subjectTemplate" TEXT,
    "bodyTemplate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "officers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "role" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "officers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstNo" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_filters" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_driver_accesses" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "temporary_driver_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transporters" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transporters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_access" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "user_source_access" (
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "user_source_access_pkey" PRIMARY KEY ("userId","source")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_centres" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "branchId" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "working_centres_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bundle_items_bundleId_documentId_key" ON "bundle_items"("bundleId" ASC, "documentId" ASC);

-- CreateIndex
CREATE INDEX "communication_jobs_bundleId_idx" ON "communication_jobs"("bundleId" ASC);

-- CreateIndex
CREATE INDEX "communication_jobs_companyId_idx" ON "communication_jobs"("companyId" ASC);

-- CreateIndex
CREATE INDEX "communication_jobs_scheduledAt_idx" ON "communication_jobs"("scheduledAt" ASC);

-- CreateIndex
CREATE INDEX "communication_jobs_status_idx" ON "communication_jobs"("status" ASC);

-- CreateIndex
CREATE INDEX "communication_messages_jobId_idx" ON "communication_messages"("jobId" ASC);

-- CreateIndex
CREATE INDEX "communication_messages_recipient_idx" ON "communication_messages"("recipient" ASC);

-- CreateIndex
CREATE INDEX "communication_messages_status_idx" ON "communication_messages"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "customer_portal_accesses_loginEmail_key" ON "customer_portal_accesses"("loginEmail" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_groups_vehicleNo_date_key" ON "document_groups"("vehicleNo" ASC, "date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_link_records_documentId_lrId_key" ON "document_link_records"("documentId" ASC, "lrId" ASC);

-- CreateIndex
CREATE INDEX "documents_sourceDocumentId_idx" ON "documents"("sourceDocumentId" ASC);

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status" ASC);

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type" ASC);

-- CreateIndex
CREATE INDEX "documents_uploadedAt_idx" ON "documents"("uploadedAt" ASC);

-- CreateIndex
CREATE INDEX "extracted_data_date_idx" ON "extracted_data"("date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "extracted_data_documentId_key" ON "extracted_data"("documentId" ASC);

-- CreateIndex
CREATE INDEX "extracted_data_invoiceNo_idx" ON "extracted_data"("invoiceNo" ASC);

-- CreateIndex
CREATE INDEX "extracted_data_lrNo_idx" ON "extracted_data"("lrNo" ASC);

-- CreateIndex
CREATE INDEX "extracted_data_reviewedAt_idx" ON "extracted_data"("reviewedAt" ASC);

-- CreateIndex
CREATE INDEX "extracted_data_transporter_idx" ON "extracted_data"("transporter" ASC);

-- CreateIndex
CREATE INDEX "extracted_data_vehicleNo_idx" ON "extracted_data"("vehicleNo" ASC);

-- CreateIndex
CREATE INDEX "extraction_profiles_branchName_idx" ON "extraction_profiles"("branchName" ASC);

-- CreateIndex
CREATE INDEX "extraction_profiles_documentType_idx" ON "extraction_profiles"("documentType" ASC);

-- CreateIndex
CREATE INDEX "extraction_profiles_principalCompany_idx" ON "extraction_profiles"("principalCompany" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "extraction_profiles_profileKey_key" ON "extraction_profiles"("profileKey" ASC);

-- CreateIndex
CREATE INDEX "extraction_profiles_transporterName_idx" ON "extraction_profiles"("transporterName" ASC);

-- CreateIndex
CREATE INDEX "lrs_companyId_idx" ON "lrs"("companyId" ASC);

-- CreateIndex
CREATE INDEX "lrs_date_idx" ON "lrs"("date" ASC);

-- CreateIndex
CREATE INDEX "lrs_lrNo_idx" ON "lrs"("lrNo" ASC);

-- CreateIndex
CREATE INDEX "lrs_serialNo_idx" ON "lrs"("serialNo" ASC);

-- CreateIndex
CREATE INDEX "lrs_vehicleNo_idx" ON "lrs"("vehicleNo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_companyId_code_key" ON "message_templates"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "message_templates_companyId_idx" ON "message_templates"("companyId" ASC);

-- CreateIndex
CREATE INDEX "message_templates_isActive_idx" ON "message_templates"("isActive" ASC);

-- CreateIndex
CREATE INDEX "officers_companyId_idx" ON "officers"("companyId" ASC);

-- CreateIndex
CREATE INDEX "officers_isActive_idx" ON "officers"("isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "parties_companyId_code_key" ON "parties"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "parties_companyId_idx" ON "parties"("companyId" ASC);

-- CreateIndex
CREATE INDEX "parties_isActive_idx" ON "parties"("isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key" ASC);

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category" ASC);

-- CreateIndex
CREATE INDEX "products_companyId_idx" ON "products"("companyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "products_companyId_name_brand_key" ON "products"("companyId" ASC, "name" ASC, "brand" ASC);

-- CreateIndex
CREATE INDEX "products_isActive_idx" ON "products"("isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key" ASC);

-- CreateIndex
CREATE INDEX "saved_filters_userId_idx" ON "saved_filters"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "temporary_driver_accesses_phone_key" ON "temporary_driver_accesses"("phone" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "transporters_companyId_code_key" ON "transporters"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "transporters_companyId_idx" ON "transporters"("companyId" ASC);

-- CreateIndex
CREATE INDEX "transporters_isActive_idx" ON "transporters"("isActive" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email" ASC);

-- CreateIndex
CREATE INDEX "working_centres_branchId_idx" ON "working_centres"("branchId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "working_centres_companyId_code_key" ON "working_centres"("companyId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "working_centres_companyId_idx" ON "working_centres"("companyId" ASC);

-- CreateIndex
CREATE INDEX "working_centres_isActive_idx" ON "working_centres"("isActive" ASC);

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "document_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_jobs" ADD CONSTRAINT "communication_jobs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "communication_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_portal_accesses" ADD CONSTRAINT "customer_portal_accesses_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_logs" ADD CONSTRAINT "dispatch_logs_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "document_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_bundles" ADD CONSTRAINT "document_bundles_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "document_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link_records" ADD CONSTRAINT "document_link_records_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link_records" ADD CONSTRAINT "document_link_records_lrId_fkey" FOREIGN KEY ("lrId") REFERENCES "lrs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "document_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_upload_documents" ADD CONSTRAINT "driver_upload_documents_linkedGroupId_fkey" FOREIGN KEY ("linkedGroupId") REFERENCES "document_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_upload_documents" ADD CONSTRAINT "driver_upload_documents_tempDriverAccessId_fkey" FOREIGN KEY ("tempDriverAccessId") REFERENCES "temporary_driver_accesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_data" ADD CONSTRAINT "extracted_data_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officers" ADD CONSTRAINT "officers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transporters" ADD CONSTRAINT "transporters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_source_access" ADD CONSTRAINT "user_source_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_centres" ADD CONSTRAINT "working_centres_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_centres" ADD CONSTRAINT "working_centres_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

