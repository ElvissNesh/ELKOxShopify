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
  Autocomplete,
  Tag,
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

  const savedCategoryMappings = await prisma.categoryMapping.findMany({
    where: { shop: session.shop },
  });

  // Fetch full names for existing category mappings
  const categoryMappings = await Promise.all(
    savedCategoryMappings.map(async (mapping: any) => {
      try {
        const res = await admin.graphql(
          `#graphql
          query getTaxonomyCategoryNode($id: ID!) {
            node(id: $id) {
              ... on TaxonomyCategory {
                id
                fullName
              }
            }
          }`,
          {
            variables: { id: mapping.shopifyTaxonomyId },
          }
        );
        const json = await res.json();
        const taxonomyNode = json.data?.node;
        return {
          ...mapping,
          taxonomyFullName: taxonomyNode?.fullName || mapping.shopifyTaxonomyId, // Fallback if not found
        };
      } catch (err) {
        console.error("Failed to load taxonomy node for", mapping.shopifyTaxonomyId, err);
        return {
          ...mapping,
          taxonomyFullName: mapping.shopifyTaxonomyId,
        };
      }
    })
  );

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

  if (intent === "save_category_mappings") {
    const mappingsJson = String(formData.get("categoryMappings") || "[]");
    let categoryMappings: Array<{ elkoCatalogCode: string; shopifyTaxonomyId: string }> = [];
    try {
      categoryMappings = JSON.parse(mappingsJson);
    } catch (e) {
      console.error("Failed to parse category mappings JSON", e);
      return { status: "error", intent: "save_category_mappings", message: "Invalid JSON format." };
    }

    // Validation: Ensure no duplicate ELKO catalog codes across all mappings
    const seenCodes = new Set();
    let hasValidationError = false;
    let validationErrorMessage = "";

    for (const mapping of categoryMappings) {
      if (!mapping.elkoCatalogCode || !mapping.shopifyTaxonomyId) continue;

      const codes = mapping.elkoCatalogCode
        .split(",")
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean);

      for (const code of codes) {
        if (seenCodes.has(code)) {
          hasValidationError = true;
          validationErrorMessage = `Duplicate ELKO Catalog Code found: "${code}". A code can only be mapped to one Shopify Category.`;
          break;
        }
        seenCodes.add(code);
      }
      if (hasValidationError) break;
    }

    if (hasValidationError) {
      return { status: "error", intent: "save_category_mappings", message: validationErrorMessage };
    }

    // Delete existing mappings for this shop
    await prisma.categoryMapping.deleteMany({
      where: { shop: session.shop },
    });

    // Create new mappings
    if (categoryMappings.length > 0) {
      // De-duplicate based on the full grouped string to prevent unique constraint errors on the exact same group
      const uniqueMappingsMap = new Map();
      categoryMappings
        .filter((m) => m.elkoCatalogCode && m.shopifyTaxonomyId)
        .forEach((m) => {
          uniqueMappingsMap.set(m.elkoCatalogCode, m);
        });

      const uniqueMappingsToInsert = Array.from(uniqueMappingsMap.values());

      if (uniqueMappingsToInsert.length > 0) {
        await prisma.categoryMapping.createMany({
          data: uniqueMappingsToInsert.map((m) => ({
            shop: session.shop,
            elkoCatalogCode: m.elkoCatalogCode,
            shopifyTaxonomyId: m.shopifyTaxonomyId,
          })),
        });
      }
    }

    return { status: "success", intent: "save_category_mappings" };
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

  // State for Category Mappings
  const [catMappings, setCatMappings] = useState<
    Array<{ id: string; elkoCatalogCode: string; elkoCatalogCodeInput: string; shopifyTaxonomyId: string; taxonomyFullName: string; searchString: string; options: Array<{value: string, label: string}>; isLoading: boolean }>
  >(
    categoryMappings.map((m: any) => ({
      id: m.id,
      elkoCatalogCode: m.elkoCatalogCode,
      elkoCatalogCodeInput: "",
      shopifyTaxonomyId: m.shopifyTaxonomyId,
      taxonomyFullName: m.taxonomyFullName,
      searchString: m.taxonomyFullName, // Initial search string is the full name
      options: [],
      isLoading: false,
    }))
  );

  const handleCatMappingChange = useCallback((index: number, field: keyof typeof catMappings[0], value: any) => {
    setCatMappings(prev => {
      const newMappings = [...prev];
      if (newMappings[index]) {
        newMappings[index] = { ...newMappings[index], [field]: value };
      }
      return newMappings;
    });
  }, []);

  const addCatMapping = () => {
    setCatMappings(prev => [
      ...prev,
      {
        id: `temp-cat-${Date.now()}`,
        elkoCatalogCode: "",
        elkoCatalogCodeInput: "",
        shopifyTaxonomyId: "",
        taxonomyFullName: "",
        searchString: "",
        options: [],
        isLoading: false,
      },
    ]);
  };

  const handleCatMappingCodeAdd = (index: number) => {
    setCatMappings(prev => {
      const newMappings = [...prev];
      const mapping = newMappings[index];
      const inputVal = mapping.elkoCatalogCodeInput.trim();

      if (inputVal) {
        // Parse input which could contain commas
        const newCodes = inputVal.split(',').map(c => c.trim()).filter(Boolean);
        const existingCodes = mapping.elkoCatalogCode ? mapping.elkoCatalogCode.split(',').map(c => c.trim()) : [];

        // Add only unique codes
        const combinedCodes = Array.from(new Set([...existingCodes, ...newCodes]));

        newMappings[index] = {
          ...mapping,
          elkoCatalogCode: combinedCodes.join(', '),
          elkoCatalogCodeInput: ""
        };
      }
      return newMappings;
    });
  };

  const handleCatMappingCodeRemove = (index: number, codeToRemove: string) => {
    setCatMappings(prev => {
      const newMappings = [...prev];
      const mapping = newMappings[index];
      const existingCodes = mapping.elkoCatalogCode ? mapping.elkoCatalogCode.split(',').map(c => c.trim()) : [];

      const updatedCodes = existingCodes.filter(c => c !== codeToRemove);

      newMappings[index] = {
        ...mapping,
        elkoCatalogCode: updatedCodes.join(', ')
      };

      return newMappings;
    });
  };

  const removeCatMapping = (index: number) => {
    setCatMappings(prev => {
      const newMappings = [...prev];
      newMappings.splice(index, 1);
      return newMappings;
    });
  };

  // Debounce taxonomy search
  const performTaxonomySearch = useCallback(
    async (index: number, query: string) => {
      handleCatMappingChange(index, "isLoading", true);
      try {
        const response = await fetch(`/api/taxonomy?query=${encodeURIComponent(query)}`);
        const data = await response.json();

        const newOptions = (data.nodes || []).map((node: any) => ({
          value: node.id,
          label: node.fullName,
        }));

        handleCatMappingChange(index, "options", newOptions);
      } catch (e) {
        console.error("Error fetching taxonomy", e);
      } finally {
        handleCatMappingChange(index, "isLoading", false);
      }
    },
    [handleCatMappingChange]
  );

  const updateSearchString = useCallback(
    (index: number, newValue: string) => {
      handleCatMappingChange(index, "searchString", newValue);

      // Clear selection if user clears the search completely
      if (!newValue) {
        handleCatMappingChange(index, "shopifyTaxonomyId", "");
        handleCatMappingChange(index, "taxonomyFullName", "");
        handleCatMappingChange(index, "options", []);
        return;
      }

      // Very simple debounce - could use lodash.debounce or useDeferredValue in a real app,
      // but for this standard React example, we'll just fire the request.
      performTaxonomySearch(index, newValue);
    },
    [handleCatMappingChange, performTaxonomySearch]
  );

  const handleTaxonomySelect = useCallback((index: number, selectedValue: string[]) => {
    if (selectedValue.length > 0) {
      const selectedId = selectedValue[0];
      setCatMappings(prev => {
        const newMappings = [...prev];
        const selectedOption = newMappings[index].options.find(opt => opt.value === selectedId);
        if (selectedOption) {
          newMappings[index] = {
            ...newMappings[index],
            shopifyTaxonomyId: selectedId,
            taxonomyFullName: selectedOption.label,
            searchString: selectedOption.label,
          };
        }
        return newMappings;
      });
    }
  }, []);

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
            {actionData?.status === "error" && actionData?.intent === "save_category_mappings" && actionData?.message && (
              <Banner tone="critical" title="Failed to save category mappings">
                <Text as="p">{actionData.message}</Text>
              </Banner>
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
                  Category Mapping Configuration
                </Text>
                <Text as="p" variant="bodyMd">
                  Map ELKO catalog codes to Shopify Standard Product Categories.
                </Text>

                <Form method="post">
                  <input type="hidden" name="intent" value="save_category_mappings" />
                  <input
                    type="hidden"
                    name="categoryMappings"
                    value={JSON.stringify(
                      catMappings.map((m) => ({
                        elkoCatalogCode: m.elkoCatalogCode,
                        shopifyTaxonomyId: m.shopifyTaxonomyId,
                      }))
                    )}
                  />

                  <BlockStack gap="400">
                    {catMappings.map((mapping, index) => (
                      <InlineStack key={mapping.id} gap="300" align="start" blockAlign="center">
                        <div style={{ flex: 1 }}>
                          <BlockStack gap="200">
                            <div onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ',') {
                                  e.preventDefault();
                                  handleCatMappingCodeAdd(index);
                                }
                            }}>
                              <TextField
                                label="ELKO Catalog Codes"
                                value={mapping.elkoCatalogCodeInput}
                                onChange={(val) => handleCatMappingChange(index, "elkoCatalogCodeInput", val)}
                                onBlur={() => handleCatMappingCodeAdd(index)}
                                autoComplete="off"
                                placeholder="Type code and press Enter or comma"
                                helpText="Press Enter to add multiple"
                              />
                            </div>
                            {mapping.elkoCatalogCode && (
                              <InlineStack gap="100" wrap>
                                {mapping.elkoCatalogCode.split(',').map(c => c.trim()).filter(Boolean).map(code => (
                                  <Tag key={code} onRemove={() => handleCatMappingCodeRemove(index, code)}>
                                    {code}
                                  </Tag>
                                ))}
                              </InlineStack>
                            )}
                          </BlockStack>
                        </div>
                        <div style={{ flex: 2 }}>
                          <Autocomplete
                            options={mapping.options}
                            selected={mapping.shopifyTaxonomyId ? [mapping.shopifyTaxonomyId] : []}
                            onSelect={(val) => handleTaxonomySelect(index, val)}
                            textField={
                              <Autocomplete.TextField
                                onChange={(val) => updateSearchString(index, val)}
                                label="Shopify Standard Category"
                                value={mapping.searchString}
                                placeholder="Search for a category (e.g., Home Appliances > Kettles)"
                                autoComplete="off"
                              />
                            }
                            loading={mapping.isLoading}
                          />
                        </div>
                        <div style={{ paddingTop: "24px" }}>
                            <Button
                                icon={DeleteIcon}
                                onClick={() => removeCatMapping(index)}
                                accessibilityLabel="Remove category mapping"
                                tone="critical"
                                variant="plain"
                            />
                        </div>
                      </InlineStack>
                    ))}

                    <Button onClick={addCatMapping} variant="secondary">
                      Add mapping
                    </Button>
                    <div style={{ marginTop: "1rem" }}>
                        <Button submit variant="primary">
                            Save Category Settings
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
