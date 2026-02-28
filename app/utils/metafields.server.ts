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

export const UPDATE_METAFIELD_DEFINITION_MUTATION = `
  mutation UpdateMetafieldDefinition($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition {
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

export const GET_METAFIELD_DEFINITION_QUERY = `
  query GetMetafieldDefinition($namespace: String!, $key: String!, $ownerType: MetafieldOwnerType!) {
    metafieldDefinitions(first: 1, namespace: $namespace, key: $key, ownerType: $ownerType) {
      edges {
        node {
          id
        }
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
      pin: true,
      capabilities: {
        adminFilterable: {
          enabled: true
        }
      }
    },
    {
      name: "Elko Product ID",
      namespace: "elko_integration",
      key: "elko_id",
      description: "The unique ID of the product in Elko.",
      type: "single_line_text_field",
      ownerType: "PRODUCT",
      pin: true,
      capabilities: {
        adminFilterable: {
          enabled: true
        }
      }
    },
  ];

  for (const definition of definitions) {
    // Check if metafield definition already exists
    const existingResponse = await admin.graphql(GET_METAFIELD_DEFINITION_QUERY, {
      variables: {
        namespace: definition.namespace,
        key: definition.key,
        ownerType: definition.ownerType,
      },
    });

    const existingResponseJson = await existingResponse.json();
    const existingId = existingResponseJson.data?.metafieldDefinitions?.edges?.[0]?.node?.id;

    if (existingId) {
      // Update existing definition to ensure capabilities are correct
      const updateResponse = await admin.graphql(UPDATE_METAFIELD_DEFINITION_MUTATION, {
        variables: {
          definition: {
            namespace: definition.namespace,
            key: definition.key,
            ownerType: definition.ownerType,
            description: definition.description,
            name: definition.name,
            pin: definition.pin,
            capabilities: definition.capabilities
          }
        },
      });

      const updateResponseJson = await updateResponse.json();
      const result = updateResponseJson.data?.metafieldDefinitionUpdate;

      if (result?.userErrors?.length > 0) {
         console.error(`Failed to update metafield definition ${definition.key}:`, result.userErrors);
      } else {
         console.log(`Updated metafield definition ${definition.key}.`);
      }

    } else {
      // Create new definition
      const response = await admin.graphql(CREATE_METAFIELD_DEFINITION_MUTATION, {
        variables: { definition },
      });

      const responseJson = await response.json();
      const result = responseJson.data?.metafieldDefinitionCreate;

      if (result?.userErrors?.length > 0) {
        console.error(`Failed to create metafield definition ${definition.key}:`, result.userErrors);
        throw new Error(`Failed to create metafield definition ${definition.key}: ${result.userErrors[0].message}`);
      } else {
          console.log(`Created metafield definition ${definition.key}.`);
      }
    }
  }
}
