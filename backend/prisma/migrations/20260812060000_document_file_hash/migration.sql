-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "fileHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "documents_fileHash_key" ON "documents"("fileHash");

