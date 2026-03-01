import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";

  // Query Shopify's taxonomy categories endpoint (API version 2025-10)
  // Searching for categories based on user's query using the new taxonomy API
  const response = await admin.graphql(
    `#graphql
      query getTaxonomyCategories($search: String!) {
        taxonomy {
          categories(first: 20, search: $search) {
            nodes {
              id
              fullName
            }
          }
        }
      }`,
    {
      variables: {
        search: query ? `${query}` : "",
      },
    }
  );

  const json: any = await response.json();

  if (json.errors) {
    console.error("GraphQL errors fetching taxonomy:", JSON.stringify(json.errors));
  }

  const nodes = json.data?.taxonomy?.categories?.nodes || [];

  return Response.json({ nodes });
};
