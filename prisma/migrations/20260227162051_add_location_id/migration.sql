-- CreateTable
CREATE TABLE "StoreConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "elkoApiKey" TEXT NOT NULL,
    "locationId" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreConfiguration_shop_key" ON "StoreConfiguration"("shop");
