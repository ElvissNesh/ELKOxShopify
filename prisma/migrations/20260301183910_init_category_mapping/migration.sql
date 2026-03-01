-- CreateTable
CREATE TABLE "CategoryMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "elkoCatalogCode" TEXT NOT NULL,
    "shopifyTaxonomyId" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryMapping_shop_elkoCatalogCode_key" ON "CategoryMapping"("shop", "elkoCatalogCode");
