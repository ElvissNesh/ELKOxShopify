import prisma from "../db.server";

export interface ElkoProduct {
  id: string; // The Elko ID (elkoCode)
  name: string;
  discountPrice: number;
  quantity: number;
  fullDsc: string;
  imagePath: string;
}

export async function fetchElkoProducts(shop: string, elkoCodes: string[]): Promise<ElkoProduct[]> {
  const config = await prisma.storeConfiguration.findUnique({
    where: { shop },
  });

  if (!config || !config.elkoApiKey) {
    throw new Error("Elko API Key not configured.");
  }

  const url = new URL("https://api.elko.cloud/v3.0/api/Catalog/Products");
  elkoCodes.forEach((code) => url.searchParams.append("elkoCode", code));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.elkoApiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Elko products: ${response.statusText}`);
  }

  const data = await response.json();

  // Map the raw data to our ElkoProduct interface
  // Adjusting field mapping based on assumptions about the API response
  // If the API returns fields with different casing or names, we'd handle it here.
  // Assuming the API returns an array of objects matching the description.

  if (!Array.isArray(data)) {
      throw new Error("Invalid response from Elko API: Expected an array.");
  }

  return data.map((item: any) => ({
    id: String(item.id || item.elkoCode || item.code), // Fallback for ID
    name: item.name,
    discountPrice: item.discountPrice,
    quantity: item.quantity,
    fullDsc: item.fullDsc,
    imagePath: item.imagePath,
  }));
}

export async function getShopifyLocation(admin: any) {
  const response = await admin.graphql(
    `query {
      locations(first: 1) {
        edges {
          node {
            id
          }
        }
      }
    }`
  );
  const data = await response.json();
  return data.data.locations.edges[0]?.node?.id;
}

export async function syncElkoProduct(admin: any, product: ElkoProduct, locationId: string) {
  // 1. Check if product exists
  const existingProductResponse = await admin.graphql(
    `query ($query: String!) {
      products(first: 1, query: $query) {
        edges {
          node {
            id
            variants(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    }`,
    {
      variables: {
        query: `metafield:elko_integration.elko_id:'${product.id}'`,
      },
    }
  );

  const existingProductJson = await existingProductResponse.json();
  const existingProduct = existingProductJson.data.products.edges[0]?.node;

  const productInput: any = {
    title: product.name,
    descriptionHtml: product.fullDsc,
    metafields: [
      {
        namespace: "elko_integration",
        key: "is_elko_product",
        value: "true",
        type: "boolean",
      },
      {
        namespace: "elko_integration",
        key: "elko_id",
        value: product.id,
        type: "single_line_text_field",
      },
    ],
  };

  // Note: For existing products, we might not want to overwrite images if they were manually changed,
  // but the requirement says "Map Data... imagePath -> Shopify Product Media".
  // For update, replacing media is complex. I'll focus on creation for media, or maybe append.
  // Let's stick to the requirement as best as possible.
  // If creating, we add the image.

  if (existingProduct) {
    // UPDATE
    productInput.id = existingProduct.id;

    // Update product
    const updateResponse = await admin.graphql(
      `mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: { input: productInput },
      }
    );

    const updateResult = await updateResponse.json();
    if (updateResult.data.productUpdate.userErrors.length > 0) {
      console.error("Product update errors:", updateResult.data.productUpdate.userErrors);
      throw new Error(updateResult.data.productUpdate.userErrors[0].message);
    }

    // Update variant price and inventory
    const variantId = existingProduct.variants.edges[0]?.node?.id;
    if (variantId) {
        // We need to use productVariantUpdate for price
        const variantInput = {
            id: variantId,
            price: product.discountPrice,
        };

        await admin.graphql(
            `mutation productVariantUpdate($input: ProductVariantInput!) {
                productVariantUpdate(input: $input) {
                    userErrors {
                        field
                        message
                    }
                }
            }`,
            { variables: { input: variantInput } }
        );

        // Update inventory
        if (locationId) {
            // We need to use inventorySetHandQuantities or similar.
            // But first we need the inventoryItemId.
            // Wait, we can use `inventoryQuantities` in `productCreate`, but for update it's harder.
            // Let's get the inventoryItemId from the variant.

             const variantResponse = await admin.graphql(
                `query {
                    productVariant(id: "${variantId}") {
                        inventoryItem {
                            id
                        }
                    }
                }`
            );
            const variantData = await variantResponse.json();
            const inventoryItemId = variantData.data.productVariant.inventoryItem.id;

            await admin.graphql(
                `mutation inventorySetHandQuantities($input: InventorySetHandQuantitiesInput!) {
                    inventorySetHandQuantities(input: $input) {
                        userErrors {
                            field
                            message
                        }
                    }
                }`,
                {
                    variables: {
                        input: {
                            reason: "correction",
                            quantities: [
                                {
                                    inventoryItemId,
                                    locationId,
                                    quantity: product.quantity
                                }
                            ]
                        }
                    }
                }
            );
        }
    }

  } else {
    // CREATE
    // Add media for creation
    if (product.imagePath) {
        productInput.media = [
            {
                originalSource: product.imagePath,
                mediaContentType: "IMAGE"
            }
        ];
    }

    // Add variants for creation
    productInput.variants = [
        {
            price: product.discountPrice,
            inventoryQuantities: locationId ? [
                {
                    availableQuantity: product.quantity,
                    locationId
                }
            ] : [],
            inventoryManagement: "SHOPIFY", // Track inventory
            inventoryPolicy: "DENY" // Stop selling when out of stock
        }
    ];

    const createResponse = await admin.graphql(
      `mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: { input: productInput },
      }
    );

    const createResult = await createResponse.json();
    if (createResult.data.productCreate.userErrors.length > 0) {
      console.error("Product create errors:", createResult.data.productCreate.userErrors);
      throw new Error(createResult.data.productCreate.userErrors[0].message);
    }
  }
}
