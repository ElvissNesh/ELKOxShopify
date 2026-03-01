-- CreateTable
CREATE TABLE "CategoryMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "elkoCategoryCode" TEXT NOT NULL,
    "shopifyCategoryId" TEXT NOT NULL,
    "shopifyCategoryName" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryMapping_shop_elkoCategoryCode_key" ON "CategoryMapping"("shop", "elkoCategoryCode");
