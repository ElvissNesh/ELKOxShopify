-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StoreConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "elkoApiKey" TEXT NOT NULL,
    "locationId" TEXT,
    "existingProductBehavior" TEXT NOT NULL DEFAULT 'skip'
);
INSERT INTO "new_StoreConfiguration" ("elkoApiKey", "id", "locationId", "shop") SELECT "elkoApiKey", "id", "locationId", "shop" FROM "StoreConfiguration";
DROP TABLE "StoreConfiguration";
ALTER TABLE "new_StoreConfiguration" RENAME TO "StoreConfiguration";
CREATE UNIQUE INDEX "StoreConfiguration_shop_key" ON "StoreConfiguration"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
