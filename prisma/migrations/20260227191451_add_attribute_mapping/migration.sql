-- CreateTable
CREATE TABLE "AttributeMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyNamespace" TEXT NOT NULL,
    "shopifyKey" TEXT NOT NULL,
    "elkoAttribute" TEXT NOT NULL,
    "metafieldType" TEXT NOT NULL DEFAULT 'single_line_text_field'
);
