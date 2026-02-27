import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createElkoMetafieldDefinitions } from "../utils/metafields.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const storeConfiguration = await prisma.storeConfiguration.findUnique({
    where: { shop: session.shop },
  });

  const response = await admin.graphql(
    `query {
      locations(first: 20) {
        nodes {
          id
          name
        }
      }
    }`
  );
  const responseJson = await response.json();
  const locations = responseJson.data?.locations?.nodes || [];

  return {
    elkoApiKey: storeConfiguration?.elkoApiKey || "",
    locationId: storeConfiguration?.locationId || "",
    locations,
  };
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
  const locationId = String(formData.get("locationId") || "");

  await prisma.storeConfiguration.upsert({
    where: { shop: session.shop },
    update: { elkoApiKey, locationId },
    create: { shop: session.shop, elkoApiKey, locationId },
  });

  return { status: "success", intent: "save_settings" };
};

export default function Settings() {
  const { elkoApiKey, locationId, locations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [apiKey, setApiKey] = useState(elkoApiKey);
  const [selectedLocation, setSelectedLocation] = useState(locationId);

  const handleChange = useCallback((newValue: string) => setApiKey(newValue), []);
  const handleLocationChange = useCallback((newValue: string) => setSelectedLocation(newValue), []);

  const locationOptions = [
    { label: "Select a location", value: "" },
    ...locations.map((loc: any) => ({ label: loc.name, value: loc.id })),
  ];

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
                  <Select
                    label="Import Location"
                    name="locationId"
                    options={locationOptions}
                    onChange={handleLocationChange}
                    value={selectedLocation}
                    helpText="Select the location where imported products will be stocked. Defaults to the first location if not specified."
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
