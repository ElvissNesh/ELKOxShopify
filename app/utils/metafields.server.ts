export const CREATE_METAFIELD_DEFINITION_MUTATION = `
  mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export async function createElkoMetafieldDefinitions(admin: any) {
  const definitions = [
    {
      name: "Is Elko Product",
      namespace: "elko_integration",
      key: "is_elko_product",
      description: "Indicates if the product is synced from Elko.",
      type: "boolean",
      ownerType: "PRODUCT",
    },
    {
      name: "Elko Product ID",
      namespace: "elko_integration",
      key: "elko_id",
      description: "The unique ID of the product in Elko.",
      type: "single_line_text_field",
      ownerType: "PRODUCT",
    },
  ];

  for (const definition of definitions) {
    const response = await admin.graphql(CREATE_METAFIELD_DEFINITION_MUTATION, {
      variables: { definition },
    });

    const responseJson = await response.json();
    const result = responseJson.data?.metafieldDefinitionCreate;

    if (result?.userErrors?.length > 0) {
      const takenError = result.userErrors.find((error: any) => error.code === "TAKEN");
      if (takenError) {
        console.log(`Metafield definition ${definition.key} already exists.`);
      } else {
        console.error(`Failed to create metafield definition ${definition.key}:`, result.userErrors);
        throw new Error(`Failed to create metafield definition ${definition.key}: ${result.userErrors[0].message}`);
      }
    } else {
        console.log(`Created metafield definition ${definition.key}.`);
    }
  }
}
