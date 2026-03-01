-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CategoryMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "elkoCatalogCode" TEXT NOT NULL,
    "shopifyTaxonomyId" TEXT NOT NULL,
    "shopifyCustomTags" TEXT NOT NULL DEFAULT ''
);
INSERT INTO "new_CategoryMapping" ("elkoCatalogCode", "id", "shop", "shopifyTaxonomyId") SELECT "elkoCatalogCode", "id", "shop", "shopifyTaxonomyId" FROM "CategoryMapping";
DROP TABLE "CategoryMapping";
ALTER TABLE "new_CategoryMapping" RENAME TO "CategoryMapping";
CREATE UNIQUE INDEX "CategoryMapping_shop_elkoCatalogCode_key" ON "CategoryMapping"("shop", "elkoCatalogCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
