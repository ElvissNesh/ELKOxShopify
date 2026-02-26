import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  BlockStack,
  Text,
  List,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createElkoMetafieldDefinitions } from "../utils/metafields.server";
import {
  fetchElkoProducts,
  syncElkoProduct,
  getShopifyLocation,
} from "../utils/elko.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const storeConfiguration = await prisma.storeConfiguration.findUnique({
    where: { shop: session.shop },
  });

  return { elkoApiKey: storeConfiguration?.elkoApiKey || "" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const intent = formData.get("intent");

  if (intent === "initialize_metafields") {
    await createElkoMetafieldDefinitions(admin);
    return { status: "success", intent: "initialize_metafields" };
  }

  if (intent === "import_products") {
    const elkoCodesInput = String(formData.get("elkoCodes") || "");
    const elkoCodes = elkoCodesInput
      .split(/[\n,]+/)
      .map((code) => code.trim())
      .filter((code) => code.length > 0);

    if (elkoCodes.length === 0) {
      return { status: "error", intent: "import_products", message: "No Elko codes provided." };
    }

    try {
      // Fetch products from Elko
      const products = await fetchElkoProducts(session.shop, elkoCodes);

      if (products.length === 0) {
          return { status: "error", intent: "import_products", message: "No products found in Elko for the provided codes." };
      }

      // Get location for inventory
      const locationId = await getShopifyLocation(admin);

      // Sync each product
      let successCount = 0;
      let failCount = 0;
      const errors = [];

      for (const product of products) {
        try {
          await syncElkoProduct(admin, product, locationId);
          successCount++;
        } catch (error: any) {
          console.error(`Failed to sync product ${product.id}:`, error);
          failCount++;
          errors.push(`ID ${product.id}: ${error.message}`);
        }
      }

      if (failCount > 0) {
          return {
              status: "partial_success",
              intent: "import_products",
              message: `Imported ${successCount} products. Failed: ${failCount}.`,
              errors
          };
      }

      return { status: "success", intent: "import_products", message: `Successfully imported ${successCount} products.` };
    } catch (error: any) {
      console.error("Import failed:", error);
      return { status: "error", intent: "import_products", message: error.message };
    }
  }

  const elkoApiKey = String(formData.get("elkoApiKey") || "");

  await prisma.storeConfiguration.upsert({
    where: { shop: session.shop },
    update: { elkoApiKey },
    create: { shop: session.shop, elkoApiKey },
  });

  return { status: "success", intent: "save_settings" };
};

export default function Settings() {
  const { elkoApiKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<any>(); // Using any for easier access to custom props
  const [apiKey, setApiKey] = useState(elkoApiKey);
  const [elkoCodes, setElkoCodes] = useState("");

  const handleChange = useCallback((newValue: string) => setApiKey(newValue), []);
  const handleCodesChange = useCallback((newValue: string) => setElkoCodes(newValue), []);

  return (
    <Page title="Elko Integration Settings">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {actionData?.status === "success" && actionData?.intent === "save_settings" && (
              <Banner tone="success" title="Settings saved" />
            )}
            {actionData?.status === "success" && actionData?.intent === "initialize_metafields" && (
              <Banner tone="success" title="Metafields initialized successfully" />
            )}
             {actionData?.intent === "import_products" && (
              <Banner
                tone={actionData.status === "success" ? "success" : "critical"}
                title={actionData.message}
              >
                 {actionData.errors && actionData.errors.length > 0 && (
                    <List type="bullet">
                        {actionData.errors.map((err: string, index: number) => (
                            <List.Item key={index}>{err}</List.Item>
                        ))}
                    </List>
                 )}
              </Banner>
            )}

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  API Configuration
                </Text>
                <Form method="post">
                  <FormLayout>
                    <TextField
                      label="Elko API Key"
                      name="elkoApiKey"
                      value={apiKey}
                      onChange={handleChange}
                      autoComplete="off"
                    />
                    <Button submit variant="primary">
                      Save
                    </Button>
                  </FormLayout>
                </Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Manual Product Import
                </Text>
                <Text as="p" variant="bodyMd">
                  Enter comma-separated ELKO IDs to import or update products in Shopify.
                </Text>
                <Form method="post">
                    <input type="hidden" name="intent" value="import_products" />
                    <FormLayout>
                        <TextField
                            label="Elko Codes"
                            name="elkoCodes"
                            value={elkoCodes}
                            onChange={handleCodesChange}
                            multiline={4}
                            autoComplete="off"
                            helpText="e.g. 101, 102, 103"
                        />
                        <Button submit>Import</Button>
                    </FormLayout>
                </Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Initialize Shopify Metafields
                </Text>
                <Text as="p" variant="bodyMd">
                  Ensure the required metafield definitions exist for Elko integration.
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="initialize_metafields" />
                  <Button submit>Initialize Shopify Metafields</Button>
                </Form>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
