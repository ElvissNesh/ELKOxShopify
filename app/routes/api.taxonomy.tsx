import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";

  // Query Shopify's productTaxonomyNodes endpoint (API version 2025-10)
  // Searching for categories based on user's query
  const response = await admin.graphql(
    `#graphql
      query getTaxonomyNodes($query: String!) {
        productTaxonomyNodes(first: 20, query: $query) {
          nodes {
            id
            fullName
          }
        }
      }`,
    {
      variables: {
        query: query ? `${query}*` : "", // simple prefix search if query exists
      },
    }
  );

  const json = await response.json();
  const nodes = json.data?.productTaxonomyNodes?.nodes || [];

  return Response.json({ nodes });
};
