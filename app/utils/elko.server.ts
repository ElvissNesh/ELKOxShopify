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
  quantity?: string | number;
  Quantity?: string | number;
  id?: string | number;
  name?: string;
  description?: string;
  price?: string | number;
}

export async function syncElkoProducts(shop: string, elkoIds: string[], admin: any) {
  console.log(`Starting syncElkoProducts for shop: ${shop} with elkoIds: ${elkoIds.join(", ")}`);
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

    console.log(`Fetching products from ELKO API: ${elkoUrl.toString()}`);
    const response = await fetch(elkoUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${storeConfig.elkoApiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch products from ELKO: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Failed to fetch products from ELKO: ${response.status} ${response.statusText}`);
    }

    const elkoProducts = await response.json();
    console.log(`Received ${Array.isArray(elkoProducts) ? elkoProducts.length : 0} products from ELKO.`);

    if (!Array.isArray(elkoProducts)) {
         throw new Error("Invalid response format from ELKO API.");
    }

    // Step B (Location): Fetch primary locationId
    console.log("Fetching primary location ID from Shopify...");
    const locationResponse = await admin.graphql(
      `query {
        locations(first: 10) {
          nodes {
            id
            isPrimary
          }
        }
      }`
    );
    const locationJson = await locationResponse.json();
    // Try to find the primary location first, otherwise fallback to the first one
    const primaryLocation = locationJson.data?.locations?.nodes?.find((loc: any) => loc.isPrimary);
    const locationId = primaryLocation?.id || locationJson.data?.locations?.nodes?.[0]?.id;

    if (!locationId) {
      console.error("Could not find any location.");
      throw new Error("Could not find any location.");
    }
    console.log(`Target Location ID found: ${locationId} (Primary: ${!!primaryLocation})`);

    // Step C (Product Shell): Iterate through fetched products
    for (const productData of elkoProducts) {
      const elkoCode = String(productData.elkoCode || productData.id);
      console.log(`Processing ELKO product: ${elkoCode} - ${productData.name || productData.title}`);
      console.log(`Raw ELKO Data for ${elkoCode}:`, JSON.stringify(productData));

      try {
        // Check if product exists using the elko_id metafield
        const existingProductResponse = await admin.graphql(
          `query ($query: String!) {
            products(first: 1, query: $query) {
              edges {
                node {
                  id
                  variants(first: 1) {
                    nodes {
                      id
                      inventoryItem {
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
              query: `metafield:elko_integration.elko_id:${elkoCode}`
            },
          }
        );

        const existingProductJson = await existingProductResponse.json();
        const existingProduct = existingProductJson.data?.products?.edges?.[0]?.node;

        let productId = existingProduct?.id;
        let variantId = existingProduct?.variants?.nodes?.[0]?.id;
        let inventoryItemId = existingProduct?.variants?.nodes?.[0]?.inventoryItem?.id;

        const productInput: any = {
          title: productData.title || productData.name || `ELKO Product ${elkoCode}`,
          descriptionHtml: productData.descriptionHtml || productData.description || "",
          vendor: productData.vendor || "ELKO",
          productType: productData.productType || "Imported",
        };

        if (existingProduct) {
           console.log(`Updating existing product: ${productId}`);
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
                 console.error(`Update failed for ${elkoCode}:`, updateJson.data.productUpdate.userErrors);
                 throw new Error(`Update failed: ${JSON.stringify(updateJson.data.productUpdate.userErrors)}`);
            }
        } else {
          console.log(`Creating new product for ELKO code: ${elkoCode}`);
          // Create new product
          // Explicitly set inventoryManagement: "SHOPIFY" to enable tracking immediately
          const createResponse = await admin.graphql(
            `mutation productCreate($input: ProductInput!) {
              productCreate(input: $input) {
                product {
                  id
                  variants(first: 1) {
                    nodes {
                      id
                      inventoryItem {
                        id
                      }
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
                input: {
                    ...productInput,
                    variants: [
                        {
                            inventoryManagement: "SHOPIFY",
                            price: String(productData.discountPrice || productData.price || "0")
                        }
                    ]
                },
              },
            }
          );
          const createJson = await createResponse.json();

          if (createJson.data?.productCreate?.userErrors?.length > 0) {
             console.error(`Create failed for ${elkoCode}:`, createJson.data.productCreate.userErrors);
             throw new Error(`Create failed: ${JSON.stringify(createJson.data.productCreate.userErrors)}`);
          }
          productId = createJson.data?.productCreate?.product?.id;
          variantId = createJson.data?.productCreate?.product?.variants?.nodes?.[0]?.id;
          inventoryItemId = createJson.data?.productCreate?.product?.variants?.nodes?.[0]?.inventoryItem?.id;
          console.log(`Product created: ${productId}, Variant: ${variantId}, InventoryItem: ${inventoryItemId}`);
        }

        // Step D (Metafields): Set elko_integration.is_elko_product and elko_integration.elko_id
        console.log(`Setting metafields for product: ${productId}`);
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
             console.log(`Attaching image: ${productData.imagePath}`);
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
                  console.log(`Updating price to: ${price}`);
                  // Also ensure inventoryManagement is SHOPIFY if we are updating
                  await admin.graphql(
                    `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                        productVariants {
                          id
                          price
                          inventoryItem {
                            id
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
                            variants: [
                                {
                                    id: variantId,
                                    price: String(price),
                                    inventoryManagement: "SHOPIFY" // Ensuring tracking is on during updates too
                                }
                            ]
                        }
                    }
                  );
             }

             // Update Inventory Logic Refactored

             // 1. Determine Quantity
             let quantityToSet: number | undefined;
             // Try 'quantity', then 'availableQuantity', then 'Quantity' (case-sensitive fallback)
             if (productData.quantity !== undefined && productData.quantity !== null) {
                 quantityToSet = parseInt(String(productData.quantity), 10);
             } else if (productData.availableQuantity !== undefined && productData.availableQuantity !== null) {
                 quantityToSet = Number(productData.availableQuantity);
             } else if (productData.Quantity !== undefined && productData.Quantity !== null) {
                 quantityToSet = parseInt(String(productData.Quantity), 10);
             }

             if (quantityToSet !== undefined && isNaN(quantityToSet)) {
                 quantityToSet = undefined;
             }

             console.log(`Parsed quantity for ${elkoCode}: ${quantityToSet} (Raw inputs - quantity: ${productData.quantity}, availableQuantity: ${productData.availableQuantity}, Quantity: ${productData.Quantity})`);

             // 2. Get Inventory Item ID (if missing)
             if (!inventoryItemId) {
                 console.log("Fetching inventory item ID (missing from prior steps)...");
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
                 inventoryItemId = variantJson.data?.productVariant?.inventoryItem?.id;
             }

             if (inventoryItemId) {
                 console.log(`Inventory Item ID: ${inventoryItemId}`);

                 // 3. Enable Tracking (Explicitly)
                 // Even though we set inventoryManagement: SHOPIFY, calling inventoryItemUpdate with tracked: true confirms it
                 // and is robust for existing items that were previously untracked.
                 console.log("Enabling inventory tracking via inventoryItemUpdate...");
                 const inventoryItemUpdateResponse = await admin.graphql(
                     `mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
                       inventoryItemUpdate(id: $id, input: $input) {
                         inventoryItem {
                           id
                           tracked
                         }
                         userErrors {
                           field
                           message
                         }
                       }
                     }`,
                     {
                       variables: {
                         id: inventoryItemId,
                         input: {
                           tracked: true
                         }
                       }
                     }
                 );

                 const invUpdateJson = await inventoryItemUpdateResponse.json();
                 if (invUpdateJson.data?.inventoryItemUpdate?.userErrors?.length > 0) {
                    console.error(`Inventory tracking enable failed: ${JSON.stringify(invUpdateJson.data.inventoryItemUpdate.userErrors)}`);
                 } else {
                    console.log("Inventory tracking confirmed enabled.");
                 }

                 // 4. Activate at Location
                 console.log(`Activating inventory item at location: ${locationId}`);
                 const activateResponse = await admin.graphql(
                     `mutation inventoryBulkToggleActivation($inventoryItemId: ID!, $inventoryItemUpdates: [InventoryBulkToggleActivationInput!]!) {
                       inventoryBulkToggleActivation(inventoryItemId: $inventoryItemId, inventoryItemUpdates: $inventoryItemUpdates) {
                         inventoryItem {
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
                         inventoryItemId: inventoryItemId,
                         inventoryItemUpdates: [
                           {
                             locationId: locationId,
                             activate: true
                           }
                         ]
                       }
                     }
                 );
                 const activateJson = await activateResponse.json();
                 // It's possible it's already active, so errors might just mean "no change needed" sometimes, but we log them.
                 if (activateJson.data?.inventoryBulkToggleActivation?.userErrors?.length > 0) {
                     console.warn(`Inventory activation warning (might be already active): ${JSON.stringify(activateJson.data.inventoryBulkToggleActivation.userErrors)}`);
                 } else {
                     console.log("Inventory item activated.");
                 }

                 // 5. Set Quantity
                 if (quantityToSet !== undefined) {
                     console.log(`Setting inventory quantity to ${quantityToSet} at location ${locationId}`);
                     const inventoryResponse = await admin.graphql(
                         `mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
                           inventorySetQuantities(input: $input) {
                             inventoryAdjustmentGroup {
                               reason
                               changes {
                                 name
                                 delta
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
                                 input: {
                                     name: "available",
                                     reason: "correction",
                                     ignoreCompareQuantity: true,
                                     quantities: [
                                         {
                                             inventoryItemId: inventoryItemId,
                                             locationId: locationId,
                                             quantity: quantityToSet
                                         }
                                     ]
                                 }
                             }
                         }
                     );
                      const invJson = await inventoryResponse.json();
                      if (invJson.data?.inventorySetQuantities?.userErrors?.length > 0) {
                           console.error(`Inventory set FAILED: ${JSON.stringify(invJson.data.inventorySetQuantities.userErrors)}`);
                      } else {
                           console.log("Inventory quantity updated successfully.");
                           console.log("Inventory set details:", JSON.stringify(invJson.data?.inventorySetQuantities));
                      }
                 } else {
                     console.log("Skipping inventory quantity set as no valid quantity was parsed from ELKO data.");
                 }

                  // 6. Verify Final State
                  console.log("Verifying final inventory level...");
                  const verifyResponse = await admin.graphql(
                    `query inventoryLevelCheck($id: ID!) {
                      inventoryItem(id: $id) {
                         tracked
                         inventoryLevels(first: 10) {
                           edges {
                             node {
                               location {
                                 id
                                 name
                               }
                               quantities(names: ["available"]) {
                                 name
                                 quantity
                               }
                             }
                           }
                         }
                      }
                    }`,
                    {
                      variables: {
                        id: inventoryItemId
                      }
                    }
                  );
                  const verifyJson = await verifyResponse.json();
                  console.log("Final Inventory State:", JSON.stringify(verifyJson.data?.inventoryItem));

             } else {
                 console.error("CRITICAL: Could not find inventory item ID for variant, cannot update inventory.");
             }
        }

        results.success++;
        console.log(`Successfully processed product: ${elkoCode}`);

      } catch (innerError: any) {
        console.error(`Failed to process product ${productData.elkoCode}:`, innerError);
        results.errors.push(`Product ${productData.elkoCode}: ${innerError.message}`);
      }
    }

    console.log("Sync completed.");
    return results;

  } catch (error: any) {
    console.error("Error syncing ELKO products:", error);
    results.errors.push(error.message);
    return results;
  }
}
