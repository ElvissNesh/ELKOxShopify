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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createElkoMetafieldDefinitions } from "../utils/metafields.server";

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
  const actionData = useActionData<typeof action>();
  const [apiKey, setApiKey] = useState(elkoApiKey);

  const handleChange = useCallback((newValue: string) => setApiKey(newValue), []);

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
            <Card>
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
