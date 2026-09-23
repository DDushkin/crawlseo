DROP INDEX "GscAiImport_siteId_fileHash_key";
CREATE UNIQUE INDEX "GscAiImport_siteId_property_fileHash_key" ON "GscAiImport"("siteId", "property", "fileHash");
