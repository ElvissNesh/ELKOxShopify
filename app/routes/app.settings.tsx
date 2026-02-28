import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import {
  Page,
  Layout,
  Card,
  TextField,
  Select,
  Button,
  Banner,
  BlockStack,
  Text,
  InlineStack,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createElkoMetafieldDefinitions } from "../utils/metafields.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const storeConfiguration = await prisma.storeConfiguration.findUnique({
    where: { shop: session.shop },
  });

  const attributeMappings = await prisma.attributeMapping.findMany({
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
    existingProductBehavior: storeConfiguration?.existingProductBehavior || "skip",
    importedProductStatus: storeConfiguration?.importedProductStatus || "ACTIVE",
    locations,
    attributeMappings,
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

  if (intent === "save_mappings") {
    const mappingsJson = String(formData.get("mappings") || "[]");
    let mappings: Array<{ shopifyNamespace: string; shopifyKey: string; elkoAttribute: string }> = [];
    try {
      mappings = JSON.parse(mappingsJson);
    } catch (e) {
      console.error("Failed to parse mappings JSON", e);
      return { status: "error", intent: "save_mappings" };
    }

    // Delete existing mappings for this shop
    await prisma.attributeMapping.deleteMany({
      where: { shop: session.shop },
    });

    // Create new mappings
    if (mappings.length > 0) {
      await prisma.attributeMapping.createMany({
        data: mappings
          .filter((m: { shopifyNamespace: string; shopifyKey: string; elkoAttribute: string }) => m.shopifyNamespace && m.shopifyKey && m.elkoAttribute)
          .map((m: { shopifyNamespace: string; shopifyKey: string; elkoAttribute: string }) => ({
            shop: session.shop,
            shopifyNamespace: m.shopifyNamespace,
            shopifyKey: m.shopifyKey,
            elkoAttribute: m.elkoAttribute,
            metafieldType: "single_line_text_field", // Default as per requirements
          })),
      });
    }

    return { status: "success", intent: "save_mappings" };
  }

  if (intent === "save_module_settings") {
    const elkoApiKey = String(formData.get("elkoApiKey") || "");

    const existingConfig = await prisma.storeConfiguration.findUnique({
      where: { shop: session.shop },
    });

    await prisma.storeConfiguration.upsert({
      where: { shop: session.shop },
      update: { elkoApiKey },
      create: {
        shop: session.shop,
        elkoApiKey,
        locationId: existingConfig?.locationId || null,
        existingProductBehavior: existingConfig?.existingProductBehavior || "skip",
        importedProductStatus: existingConfig?.importedProductStatus || "ACTIVE"
      },
    });

    return { status: "success", intent: "save_module_settings" };
  }

  if (intent === "save_import_settings") {
    const locationId = String(formData.get("locationId") || "");
    const existingProductBehavior = String(formData.get("existingProductBehavior") || "skip");
    const importedProductStatus = String(formData.get("importedProductStatus") || "ACTIVE");

    const existingConfig = await prisma.storeConfiguration.findUnique({
      where: { shop: session.shop },
    });

    await prisma.storeConfiguration.upsert({
      where: { shop: session.shop },
      update: { locationId, existingProductBehavior, importedProductStatus },
      create: {
        shop: session.shop,
        elkoApiKey: existingConfig?.elkoApiKey || "",
        locationId,
        existingProductBehavior,
        importedProductStatus
      },
    });

    return { status: "success", intent: "save_import_settings" };
  }

  return { status: "error", intent: "unknown" };
};

export default function Settings() {
  const { elkoApiKey, locationId, existingProductBehavior, importedProductStatus, locations, attributeMappings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [apiKey, setApiKey] = useState(elkoApiKey);
  const [selectedLocation, setSelectedLocation] = useState(locationId);
  const [selectedExistingProductBehavior, setSelectedExistingProductBehavior] = useState(existingProductBehavior);
  const [selectedImportedProductStatus, setSelectedImportedProductStatus] = useState(importedProductStatus);

  // State for Attribute Mappings
  const [mappings, setMappings] = useState<
    Array<{ id: string; shopifyNamespace: string; shopifyKey: string; elkoAttribute: string }>
  >(
    attributeMappings.map((m: { id: string; shopifyNamespace: string; shopifyKey: string; elkoAttribute: string }) => ({
      id: m.id,
      shopifyNamespace: m.shopifyNamespace,
      shopifyKey: m.shopifyKey,
      elkoAttribute: m.elkoAttribute,
    }))
  );

  const handleChange = useCallback((newValue: string) => setApiKey(newValue), []);
  const handleLocationChange = useCallback((newValue: string) => setSelectedLocation(newValue), []);
  const handleExistingProductBehaviorChange = useCallback((newValue: string) => setSelectedExistingProductBehavior(newValue), []);
  const handleImportedProductStatusChange = useCallback((newValue: string) => setSelectedImportedProductStatus(newValue), []);

  const handleMappingChange = (index: number, field: keyof typeof mappings[0], value: string) => {
    const newMappings = [...mappings];
    if (newMappings[index]) {
      newMappings[index] = { ...newMappings[index], [field]: value };
      setMappings(newMappings);
    }
  };

  const addMapping = () => {
    setMappings([
      ...mappings,
      {
        id: `temp-${Date.now()}`,
        shopifyNamespace: "",
        shopifyKey: "",
        elkoAttribute: "",
      },
    ]);
  };

  const removeMapping = (index: number) => {
    const newMappings = [...mappings];
    newMappings.splice(index, 1);
    setMappings(newMappings);
  };

  const locationOptions = [
    { label: "Select a location", value: "" },
    ...locations.map((loc: { id: string; name: string }) => ({ label: loc.name, value: loc.id })),
  ];

  const existingProductBehaviorOptions = [
    { label: "Skip existing products", value: "skip" },
    { label: "Update products", value: "update_all" },
    { label: "Update all except price", value: "update_except_price" },
  ];

  const importedProductStatusOptions = [
    { label: "Active", value: "ACTIVE" },
    { label: "Draft", value: "DRAFT" },
  ];

  return (
    <Page title="Elko Integration Settings">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {actionData?.status === "success" && actionData?.intent === "save_module_settings" && (
              <Banner tone="success" title="Module settings saved" />
            )}
            {actionData?.status === "success" && actionData?.intent === "save_import_settings" && (
              <Banner tone="success" title="Import settings saved" />
            )}
            {actionData?.status === "success" && actionData?.intent === "save_mappings" && (
              <Banner tone="success" title="Attribute mappings saved" />
            )}
            {actionData?.status === "success" && actionData?.intent === "initialize_metafields" && (
              <Banner tone="success" title="Metafields initialized successfully" />
            )}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Module Settings
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="save_module_settings" />
                  <BlockStack gap="300">
                    <TextField
                      label="Elko API Key"
                      name="elkoApiKey"
                      value={apiKey}
                      onChange={handleChange}
                      autoComplete="off"
                    />
                    <div style={{ marginTop: "0.5rem" }}>
                      <Button submit variant="primary">
                        Save
                      </Button>
                    </div>
                  </BlockStack>
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

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Product Import Settings
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="save_import_settings" />
                  <BlockStack gap="300">
                    <Select
                      label="Product Import stock location"
                      name="locationId"
                      options={locationOptions}
                      onChange={handleLocationChange}
                      value={selectedLocation}
                      helpText="Select the location where imported products will be stocked. Defaults to the first location if not specified."
                    />
                    <Select
                      label="Import setting for existing products"
                      name="existingProductBehavior"
                      options={existingProductBehaviorOptions}
                      onChange={handleExistingProductBehaviorChange}
                      value={selectedExistingProductBehavior}
                      helpText="Choose how to handle products that have already been imported."
                    />
                    <Select
                      label="Imported product status"
                      name="importedProductStatus"
                      options={importedProductStatusOptions}
                      onChange={handleImportedProductStatusChange}
                      value={selectedImportedProductStatus}
                      helpText="Choose the default status for newly imported products."
                    />
                    <div style={{ marginTop: "0.5rem" }}>
                      <Button submit variant="primary">
                        Save
                      </Button>
                    </div>
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Product Import attribute mapping
                </Text>
                <Text as="p" variant="bodyMd">
                  Map ELKO product attributes to Shopify Metafields.
                </Text>

                <Form method="post">
                  <input type="hidden" name="intent" value="save_mappings" />
                  <input
                    type="hidden"
                    name="mappings"
                    value={JSON.stringify(
                      mappings.map((m) => ({
                        shopifyNamespace: m.shopifyNamespace,
                        shopifyKey: m.shopifyKey,
                        elkoAttribute: m.elkoAttribute,
                      }))
                    )}
                  />

                  <BlockStack gap="400">
                    {mappings.map((mapping, index) => (
                      <InlineStack key={mapping.id} gap="300" align="start" blockAlign="center">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Shopify Namespace"
                            value={mapping.shopifyNamespace}
                            onChange={(val) => handleMappingChange(index, "shopifyNamespace", val)}
                            autoComplete="off"
                            placeholder="custom"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Shopify Key"
                            value={mapping.shopifyKey}
                            onChange={(val) => handleMappingChange(index, "shopifyKey", val)}
                            autoComplete="off"
                            placeholder="warranty"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="ELKO Attribute"
                            value={mapping.elkoAttribute}
                            onChange={(val) => handleMappingChange(index, "elkoAttribute", val)}
                            autoComplete="off"
                            placeholder="fullDsc"
                          />
                        </div>
                        <div style={{ paddingTop: "24px" }}>
                            <Button
                                icon={DeleteIcon}
                                onClick={() => removeMapping(index)}
                                accessibilityLabel="Remove mapping"
                                tone="critical"
                                variant="plain"
                            />
                        </div>
                      </InlineStack>
                    ))}

                    <Button onClick={addMapping} variant="secondary">
                      Add Mapping
                    </Button>
                    <div style={{ marginTop: "1rem" }}>
                        <Button submit variant="primary">
                            Save Mappings
                        </Button>
                    </div>
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
