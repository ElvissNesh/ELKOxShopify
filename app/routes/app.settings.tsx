import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, useFetcher } from "react-router";
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
  Autocomplete,
  Icon,
} from "@shopify/polaris";
import { DeleteIcon, SearchIcon } from "@shopify/polaris-icons";
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

  const categoryMappings = await prisma.categoryMapping.findMany({
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
    categoryMappings,
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

  if (intent === "save_category_mappings") {
    const mappingsJson = String(formData.get("categoryMappings") || "[]");
    let categoryMappings: Array<{ elkoCategoryCode: string; shopifyCategoryId: string; shopifyCategoryName: string }> = [];
    try {
      categoryMappings = JSON.parse(mappingsJson);
    } catch (e) {
      console.error("Failed to parse category mappings JSON", e);
      return { status: "error", intent: "save_category_mappings", message: "Failed to parse JSON" };
    }

    // Check for duplicates in UI input
    const elkoCodes = categoryMappings.map(m => m.elkoCategoryCode);
    if (new Set(elkoCodes).size !== elkoCodes.length) {
      return { status: "error", intent: "save_category_mappings", message: "Duplicate ELKO Category Codes are not allowed." };
    }

    // Delete existing mappings for this shop
    await prisma.categoryMapping.deleteMany({
      where: { shop: session.shop },
    });

    // Create new mappings
    if (categoryMappings.length > 0) {
      await prisma.categoryMapping.createMany({
        data: categoryMappings
          .filter((m) => m.elkoCategoryCode && m.shopifyCategoryId && m.shopifyCategoryName)
          .map((m) => ({
            shop: session.shop,
            elkoCategoryCode: m.elkoCategoryCode,
            shopifyCategoryId: m.shopifyCategoryId,
            shopifyCategoryName: m.shopifyCategoryName,
          })),
      });
    }

    return { status: "success", intent: "save_category_mappings" };
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
  const { elkoApiKey, locationId, existingProductBehavior, importedProductStatus, locations, attributeMappings, categoryMappings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [apiKey, setApiKey] = useState(elkoApiKey);
  const [selectedLocation, setSelectedLocation] = useState(locationId);
  const [selectedExistingProductBehavior, setSelectedExistingProductBehavior] = useState(existingProductBehavior);
  const [selectedImportedProductStatus, setSelectedImportedProductStatus] = useState(importedProductStatus);

  // State for Category Mappings
  const [catMappings, setCatMappings] = useState<
    Array<{ id: string; elkoCategoryCode: string; shopifyCategoryId: string; shopifyCategoryName: string; inputValue: string }>
  >(
    categoryMappings.map((m: any) => ({
      id: m.id,
      elkoCategoryCode: m.elkoCategoryCode,
      shopifyCategoryId: m.shopifyCategoryId,
      shopifyCategoryName: m.shopifyCategoryName,
      inputValue: m.shopifyCategoryName,
    }))
  );

  // Fetcher for taxonomy search
  const fetcher = useFetcher<any>();

  const handleCategoryMappingChange = (index: number, field: keyof typeof catMappings[0], value: string) => {
    const newMappings = [...catMappings];
    if (newMappings[index]) {
      newMappings[index] = { ...newMappings[index], [field]: value };
      setCatMappings(newMappings);
    }
  };

  const addCategoryMapping = () => {
    setCatMappings([
      ...catMappings,
      {
        id: `temp-${Date.now()}`,
        elkoCategoryCode: "",
        shopifyCategoryId: "",
        shopifyCategoryName: "",
        inputValue: "",
      },
    ]);
  };

  const removeCategoryMapping = (index: number) => {
    const newMappings = [...catMappings];
    newMappings.splice(index, 1);
    setCatMappings(newMappings);
  };

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
            {actionData?.status === "success" && actionData?.intent === "save_category_mappings" && (
              <Banner tone="success" title="Category mappings saved" />
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
                  Category Mapping
                </Text>
                <Text as="p" variant="bodyMd">
                  Map ELKO Categories to Official Shopify Product Categories.
                </Text>

                <Form method="post">
                  <input type="hidden" name="intent" value="save_category_mappings" />
                  <input
                    type="hidden"
                    name="categoryMappings"
                    value={JSON.stringify(
                      catMappings.map((m) => ({
                        elkoCategoryCode: m.elkoCategoryCode,
                        shopifyCategoryId: m.shopifyCategoryId,
                        shopifyCategoryName: m.shopifyCategoryName,
                      }))
                    )}
                  />

                  <BlockStack gap="400">
                    {catMappings.map((mapping, index) => {
                      const updateText = (value: string) => {
                        handleCategoryMappingChange(index, "inputValue", value);
                        fetcher.load(`/api/taxonomy?query=${encodeURIComponent(value)}`);
                      };

                      const fetchInitialOptions = () => {
                        if (!mapping.inputValue) {
                          fetcher.load(`/api/taxonomy?query=`);
                        }
                      };

                      const options = fetcher.data?.categories?.map((cat: any) => ({
                        value: cat.id,
                        label: cat.fullName,
                      })) || [];

                      const textField = (
                        <Autocomplete.TextField
                          onChange={updateText}
                          onFocus={fetchInitialOptions}
                          label="Shopify Category"
                          value={mapping.inputValue}
                          prefix={<Icon source={SearchIcon} tone="base" />}
                          placeholder="Search Categories..."
                          autoComplete="off"
                        />
                      );

                      return (
                        <InlineStack key={mapping.id} gap="300" align="start" blockAlign="center">
                          <div style={{ flex: 1 }}>
                            <Autocomplete
                              options={options}
                              selected={[mapping.shopifyCategoryId]}
                              onSelect={(selected) => {
                                const selectedOption = options.find((o: any) => o.value === selected[0]);
                                if (selectedOption) {
                                  handleCategoryMappingChange(index, "shopifyCategoryId", selectedOption.value);
                                  handleCategoryMappingChange(index, "shopifyCategoryName", selectedOption.label);
                                  handleCategoryMappingChange(index, "inputValue", selectedOption.label);
                                }
                              }}
                              textField={textField}
                            />
                            {mapping.shopifyCategoryName && mapping.shopifyCategoryId && (
                                <Text as="p" tone="subdued" variant="bodySm">
                                  Saved: {mapping.shopifyCategoryName}
                                </Text>
                            )}
                          </div>
                          <div style={{ flex: 1 }}>
                            <TextField
                              label="ELKO Category Code"
                              value={mapping.elkoCategoryCode}
                              onChange={(val) => handleCategoryMappingChange(index, "elkoCategoryCode", val)}
                              autoComplete="off"
                              placeholder="102-01"
                            />
                          </div>
                          <div style={{ paddingTop: "24px" }}>
                            <Button
                              icon={DeleteIcon}
                              onClick={() => removeCategoryMapping(index)}
                              accessibilityLabel="Remove mapping"
                              tone="critical"
                              variant="plain"
                            />
                          </div>
                        </InlineStack>
                      );
                    })}

                    {actionData?.status === "error" && actionData?.intent === "save_category_mappings" && (
                      <Text as="p" tone="critical">
                        {actionData.message}
                      </Text>
                    )}

                    <Button onClick={addCategoryMapping} variant="secondary">
                      Add Category Mapping
                    </Button>
                    <div style={{ marginTop: "1rem" }}>
                      <Button submit variant="primary">
                        Save Category Mappings
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
