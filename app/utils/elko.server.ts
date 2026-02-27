import prisma from "../db.server";

export async function syncElkoProducts(shop: string, elkoIds: string[], admin: any) {
  const results = {
    success: 0,
    errors: [] as string[],
  };

  try {
    const storeConfig = await prisma.storeConfiguration.findUnique({
      where: { shop },
    });

    if (!storeConfig?.elkoApiKey) {
      throw new Error("ELKO API Key not configured.");
    }

    const elkoUrl = new URL("https://api.elko.cloud/v3.0/api/Catalog/Products");
    elkoIds.forEach((id) => elkoUrl.searchParams.append("elkoCode", id.trim()));

    const response = await fetch(elkoUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${storeConfig.elkoApiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) throw new Error(`ELKO API Error: ${response.status}`);
    const elkoProducts = await response.json();

    const locationResponse = await admin.graphql(
      `query {
        locations(first: 1) {
          nodes { id }
        }
      }`
    );
    const locationJson = await locationResponse.json();
    const locationId = locationJson.data?.locations?.nodes?.[0]?.id;

    if (!locationId) throw new Error("No active Shopify location found.");

    for (const productData of elkoProducts) {
      try {
        const elkoCode = String(productData.elkoCode);
        
        const existingProductResponse = await admin.graphql(
          `query ($query: String!) {
            products(first: 1, query: $query) {
              nodes {
                id
                variants(first: 1) {
                  nodes { id inventoryItem { id } }
                }
              }
            }
          }`,
          { variables: { query: `metafield:elko_integration.elko_id:${elkoCode}` } }
        );

        const existingProductJson = await existingProductResponse.json();
        const existingProduct = existingProductJson.data?.products?.nodes?.[0];

        let productId = existingProduct?.id;
        let variantId = existingProduct?.variants?.nodes?.[0]?.id;
        let inventoryItemId = existingProduct?.variants?.nodes?.[0]?.inventoryItem?.id;

        const productInput = {
          title: productData.name,
          descriptionHtml: productData.fullDsc,
          vendor: productData.vendorName,
          productType: productData.catalogName,
          status: "ACTIVE"
        };

        if (existingProduct) {
          await admin.graphql(
            `mutation productUpdate($input: ProductInput!) {
              productUpdate(input: $input) { product { id } }
            }`,
            { variables: { input: { id: productId, ...productInput } } }
          );
        } else {
          const createResponse = await admin.graphql(
            `mutation productCreate($input: ProductInput!) {
              productCreate(input: $input) {
                product {
                  id
                  variants(first: 1) { nodes { id inventoryItem { id } } }
                }
              }
            }`,
            { variables: { input: productInput } }
          );
          const createJson = await createResponse.json();
          productId = createJson.data.productCreate.product.id;
          variantId = createJson.data.productCreate.product.variants.nodes[0].id;
          inventoryItemId = createJson.data.productCreate.product.variants.nodes[0].inventoryItem.id;
        }

        await admin.graphql(
          `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) { userErrors { message } }
          }`,
          { variables: { metafields: [
            { ownerId: productId, namespace: "elko_integration", key: "is_elko_product", value: "true", type: "boolean" },
            { ownerId: productId, namespace: "elko_integration", key: "elko_id", value: elkoCode, type: "single_line_text_field" }
          ]}}
        );

        if (productData.imagePath) {
          await admin.graphql(
            `mutation productCreateMedia($media: [CreateMediaInput!]!, $productId: ID!) {
              productCreateMedia(media: $media, productId: $productId) { media { id } }
            }`,
            { variables: { productId, media: [{ originalSource: productData.imagePath, mediaContentType: "IMAGE" }] } }
          );
        }

        if (variantId && inventoryItemId) {
          // Update Price
          await admin.graphql(
            `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id } }
            }`,
            { variables: { productId, variants: [{ id: variantId, price: String(productData.discountPrice) }] } }
          );

          // Enable Tracking
          await admin.graphql(
            `mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
              inventoryItemUpdate(id: $id, input: $input) { inventoryItem { id tracked } }
            }`,
            { variables: { id: inventoryItemId, input: { tracked: true } } }
          );

          // SET QUANTITY
          const qty = parseInt(productData.quantity, 10) || 0;
          console.log(`Force syncing stock for ${elkoCode}: ${qty} units to ${locationId}`);

          await admin.graphql(
            `mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
              inventorySetQuantities(input: $input) {
                inventoryQuantities {
                  availableQuantity
                }
                userErrors { message }
              }
            }`,
            { variables: { input: {
              name: "available",
              reason: "correction",
              ignoreCompareQuantity: true,
              quantities: [{ inventoryItemId, locationId, quantity: qty }]
            }}}
          );
        }

        results.success++;
      } catch (innerError: any) {
        results.errors.push(`Product ${productData.elkoCode}: ${innerError.message}`);
      }
    }
    return results;
  } catch (error: any) {
    results.errors.push(error.message);
    return results;
  }
}
