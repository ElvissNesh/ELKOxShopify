import prisma from "../db.server";

// Define the Elko product structure based on the prompt's description and typical API responses
interface ElkoProduct {
  elkoCode: string;
  title: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  imagePath?: string;
  discountPrice?: string; // Assuming string or number, will convert
  availableQuantity?: number;
}

export async function syncElkoProducts(shop: string, elkoIds: string[], admin: any) {
  const results = {
    success: 0,
    errors: [] as string[],
  };

  try {
    // Step A: Fetch API Key
    const storeConfig = await prisma.storeConfiguration.findUnique({
      where: { shop },
    });

    if (!storeConfig?.elkoApiKey) {
      throw new Error("ELKO API Key not configured.");
    }

    // Step A (Fetcher): Fetch data from ELKO
    // Using a POST request or GET with params as specified. Prompt says "append repeating query parameters".
    const elkoUrl = new URL("https://api.elko.cloud/v3.0/api/Catalog/Products");
    elkoIds.forEach((id) => elkoUrl.searchParams.append("elkoCode", id.trim()));

    // Assuming GET request based on query params description
    const response = await fetch(elkoUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${storeConfig.elkoApiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch products from ELKO: ${response.status} ${response.statusText}`);
    }

    const elkoProducts = await response.json();

    if (!Array.isArray(elkoProducts)) {
         throw new Error("Invalid response format from ELKO API.");
    }

    // Step B (Location): Fetch primary locationId
    const locationResponse = await admin.graphql(
      `query {
        locations(first: 1) {
          nodes {
            id
          }
        }
      }`
    );
    const locationJson = await locationResponse.json();
    const locationId = locationJson.data?.locations?.nodes?.[0]?.id;

    if (!locationId) {
      throw new Error("Could not find primary location.");
    }

    // Step C (Product Shell): Iterate through fetched products
    for (const productData of elkoProducts) {
      try {
        const elkoCode = String(productData.elkoCode || productData.id); // Fallback if needed

        // Check if product exists using the elko_id metafield
        const existingProductResponse = await admin.graphql(
          `query ($key: String!, $value: String!) {
            products(first: 1, query: $query) {
              edges {
                node {
                  id
                  variants(first: 1) {
                    nodes {
                      id
                    }
                  }
                }
              }
            }
          }`,
          {
            variables: {
              key: "elko_integration.elko_id",
              value: elkoCode,
              query: `metafield:elko_integration.elko_id:${elkoCode}`
            },
          }
        );

        const existingProductJson = await existingProductResponse.json();
        const existingProduct = existingProductJson.data?.products?.edges?.[0]?.node;

        let productId = existingProduct?.id;
        let variantId = existingProduct?.variants?.nodes?.[0]?.id;

        const productInput: any = {
          title: productData.title || productData.name || `ELKO Product ${elkoCode}`,
          descriptionHtml: productData.descriptionHtml || productData.description || "",
          vendor: productData.vendor || "ELKO",
          productType: productData.productType || "Imported",
        };

        if (existingProduct) {
           // Update existing product
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
               variables: {
                 input: {
                   id: productId,
                   ...productInput
                 },
               },
             }
           );
           const updateJson = await updateResponse.json();
            if (updateJson.data?.productUpdate?.userErrors?.length > 0) {
                 throw new Error(`Update failed: ${JSON.stringify(updateJson.data.productUpdate.userErrors)}`);
            }
        } else {
          // Create new product
          const createResponse = await admin.graphql(
            `mutation productCreate($input: ProductInput!) {
              productCreate(input: $input) {
                product {
                  id
                  variants(first: 1) {
                    nodes {
                      id
                    }
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                input: productInput,
              },
            }
          );
          const createJson = await createResponse.json();

          if (createJson.data?.productCreate?.userErrors?.length > 0) {
             throw new Error(`Create failed: ${JSON.stringify(createJson.data.productCreate.userErrors)}`);
          }
          productId = createJson.data?.productCreate?.product?.id;
          variantId = createJson.data?.productCreate?.product?.variants?.nodes?.[0]?.id;
        }

        // Step D (Metafields): Set elko_integration.is_elko_product and elko_integration.elko_id
        // We can do this via productUpdate or separate mutation. Doing via productUpdate for efficiency usually,
        // but here let's ensure it's set specifically.
        // Actually, let's use metafieldsSet for clarity and batching if needed later.
        const metafieldsSetResponse = await admin.graphql(
            `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
                variables: {
                    metafields: [
                        {
                            ownerId: productId,
                            namespace: "elko_integration",
                            key: "is_elko_product",
                            value: "true",
                            type: "boolean"
                        },
                        {
                            ownerId: productId,
                            namespace: "elko_integration",
                            key: "elko_id",
                            value: elkoCode,
                            type: "single_line_text_field"
                        }
                    ]
                }
            }
        );
         const metafieldsJson = await metafieldsSetResponse.json();
         if (metafieldsJson.data?.metafieldsSet?.userErrors?.length > 0) {
             console.warn(`Metafields set warning: ${JSON.stringify(metafieldsJson.data.metafieldsSet.userErrors)}`);
         }

        // Step E (Media): Attach ELKO imagePath
        if (productData.imagePath) {
             const mediaResponse = await admin.graphql(
                `mutation productCreateMedia($media: [CreateMediaInput!]!, $productId: ID!) {
                  productCreateMedia(media: $media, productId: $productId) {
                    media {
                      alt
                      mediaContentType
                      preview {
                        image {
                          id
                          originalSrc
                        }
                      }
                    }
                    userErrors {
                      field
                      message
                    }
                  }
                }`,
                {
                    variables: {
                        productId: productId,
                        media: [
                            {
                                originalSource: productData.imagePath,
                                mediaContentType: "IMAGE"
                            }
                        ]
                    }
                }
             );
              // We ignore errors here for now as image might already exist or fail, shouldn't block the whole sync
              const mediaJson = await mediaResponse.json();
               if (mediaJson.data?.productCreateMedia?.userErrors?.length > 0) {
                    console.warn(`Media create warning: ${JSON.stringify(mediaJson.data.productCreateMedia.userErrors)}`);
               }
        }

        // Step F (Variants & Inventory)
        if (variantId) {
             // Update price
             const price = productData.discountPrice || productData.price;
             if (price) {
                  await admin.graphql(
                    `mutation productVariantUpdate($input: ProductVariantInput!) {
                      productVariantUpdate(input: $input) {
                        userErrors {
                          field
                          message
                        }
                      }
                    }`,
                    {
                        variables: {
                            input: {
                                id: variantId,
                                price: String(price)
                            }
                        }
                    }
                  );
             }

             // Update Inventory
             if (productData.availableQuantity !== undefined) {
                 // First we need the inventoryItemId
                 const variantResponse = await admin.graphql(
                     `query {
                         productVariant(id: "${variantId}") {
                             inventoryItem {
                                 id
                             }
                         }
                     }`
                 );
                 const variantJson = await variantResponse.json();
                 const inventoryItemId = variantJson.data?.productVariant?.inventoryItem?.id;

                 if (inventoryItemId) {
                     const inventoryResponse = await admin.graphql(
                         `mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
                           inventorySetQuantities(input: $input) {
                             userErrors {
                               field
                               message
                             }
                           }
                         }`,
                         {
                             variables: {
                                 input: {
                                     name: "available",
                                     reason: "correction",
                                     ignoreCompareQuantity: true,
                                     quantities: [
                                         {
                                             inventoryItemId: inventoryItemId,
                                             locationId: locationId,
                                             quantity: Number(productData.availableQuantity)
                                         }
                                     ]
                                 }
                             }
                         }
                     );
                      const invJson = await inventoryResponse.json();
                      if (invJson.data?.inventorySetQuantities?.userErrors?.length > 0) {
                           console.warn(`Inventory set warning: ${JSON.stringify(invJson.data.inventorySetQuantities.userErrors)}`);
                      }
                 }
             }
        }

        results.success++;

      } catch (innerError: any) {
        console.error(`Failed to process product ${productData.elkoCode}:`, innerError);
        results.errors.push(`Product ${productData.elkoCode}: ${innerError.message}`);
      }
    }

    return results;

  } catch (error: any) {
    console.error("Error syncing ELKO products:", error);
    results.errors.push(error.message);
    return results;
  }
}
