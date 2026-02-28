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

const parseQuantity = (val: string | number | undefined | null): number | undefined => {
    if (val === undefined || val === null) return undefined;
    // Convert to string and strip > symbol and any extra spaces
    const cleanedVal = String(val).replace(/>/g, '').trim();
    return parseInt(cleanedVal, 10);
};

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

    // Fetch mappings for the current shop
    const mappings = await prisma.attributeMapping.findMany({ where: { shop } });

    const existingProductBehavior = storeConfig.existingProductBehavior || "skip";
    console.log(`Behavior for existing products: ${existingProductBehavior}`);

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

    // Step B (Location): Determine Location ID
    let locationId = storeConfig.locationId;

    if (locationId) {
      console.log(`Using configured location ID: ${locationId}`);
    } else {
      console.log("No location configured. Fetching primary location ID from Shopify...");
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
      locationId = locationJson.data?.locations?.nodes?.[0]?.id;

      if (!locationId) {
        console.error("Could not find primary location.");
        throw new Error("Could not find primary location.");
      }
      console.log(`Primary location ID found: ${locationId}`);
    }

    // Step C (Product Shell): Iterate through fetched products
    for (const productData of elkoProducts) {
      const elkoCode = String(productData.elkoCode || productData.id);
      console.log(`Processing ELKO product: ${elkoCode} - ${productData.name || productData.title}`);

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
                    }
                  }
                }
              }
            }
          }`,
          {
            variables: {
              query: `metafields.elko_integration.elko_id:${elkoCode}`
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
           if (existingProductBehavior === "skip") {
               console.log(`Skipping existing product: ${productId} (Behavior is set to 'skip')`);
               continue;
           }

           console.log(`Updating existing product: ${productId} (Behavior is set to '${existingProductBehavior}')`);
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
             console.error(`Create failed for ${elkoCode}:`, createJson.data.productCreate.userErrors);
             throw new Error(`Create failed: ${JSON.stringify(createJson.data.productCreate.userErrors)}`);
          }
          productId = createJson.data?.productCreate?.product?.id;
          variantId = createJson.data?.productCreate?.product?.variants?.nodes?.[0]?.id;
          console.log(`Product created: ${productId}, Variant: ${variantId}`);
        }

        // Step D (Metafields): Set elko_integration.is_elko_product and elko_integration.elko_id
        console.log(`Setting metafields for product: ${productId}`);

        const dynamicMetafields = mappings.map(m => ({
          ownerId: productId,
          namespace: m.shopifyNamespace,
          key: m.shopifyKey,
          value: String((productData as any)[m.elkoAttribute] || ""),
          type: "single_line_text_field"
        })).filter(meta => meta.value !== "");

        console.log(`[Sync] Mapping ${dynamicMetafields.length} custom attributes for ${elkoCode}.`);

        const metafields = [
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
            },
            ...dynamicMetafields
        ];

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
                    metafields
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
             const shouldUpdatePrice = !existingProduct || existingProductBehavior !== "update_except_price";

             if (price && shouldUpdatePrice) {
                  console.log(`Updating price to: ${price}`);
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
                                    price: String(price)
                                }
                            ]
                        }
                    }
                  );
             }

             // Update Inventory
             // Determine quantity to use: try 'quantity', then 'availableQuantity', then 'Quantity' (case-sensitive fallback)
             let quantityToSet: number | undefined;

             if (productData.quantity !== undefined && productData.quantity !== null) {
                 quantityToSet = parseQuantity(productData.quantity);
             } else if (productData.availableQuantity !== undefined && productData.availableQuantity !== null) {
                 quantityToSet = parseQuantity(productData.availableQuantity);
             } else if (productData.Quantity !== undefined && productData.Quantity !== null) {
                 quantityToSet = parseQuantity(productData.Quantity);
             }

             // Handle NaN from parsing
             if (quantityToSet !== undefined && isNaN(quantityToSet)) {
                 quantityToSet = undefined;
             }

             console.log(`Determined quantity to set: ${quantityToSet}`);

             if (quantityToSet !== undefined) {
                 // First we need the inventoryItemId
                 console.log("Fetching inventory item ID...");
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
                     console.log(`Inventory Item ID: ${inventoryItemId}. Enabling tracking and checking stocking status...`);

                     // Enable inventory tracking
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
                        console.log("Inventory tracking enabled.");
                     }

                     // Activate inventory at location if needed
                     console.log(`Ensuring inventory item is stocked at location: ${locationId}`);
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
                     if (activateJson.data?.inventoryBulkToggleActivation?.userErrors?.length > 0) {
                         console.warn(`Inventory activation warning: ${JSON.stringify(activateJson.data.inventoryBulkToggleActivation.userErrors)}`);
                     } else {
                         console.log("Inventory item activated at location.");
                     }

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
                           console.warn(`Inventory set warning: ${JSON.stringify(invJson.data.inventorySetQuantities.userErrors)}`);
                      } else {
                           console.log("Inventory set response:", JSON.stringify(invJson.data?.inventorySetQuantities));
                      }

                      // Verify inventory
                      console.log("Verifying inventory level after update...");
                      const verifyResponse = await admin.graphql(
                        `query inventoryLevelCheck($id: ID!) {
                          inventoryItem(id: $id) {
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
                      console.log("Inventory Verification Result:", JSON.stringify(verifyJson.data?.inventoryItem));

                 } else {
                     console.error("Could not find inventory item ID for variant.");
                 }
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
