import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";

  if (!query || query.length < 2) {
    return new Response(JSON.stringify({ categories: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const response = await admin.graphql(
      `query taxonomyCategories($query: String!) {
        taxonomyCategories(first: 20, query: $query) {
          nodes {
            id
            fullName
          }
        }
      }`,
      {
        variables: {
          query: query,
        },
      }
    );

    const responseJson = await response.json();
    const categories = responseJson.data?.taxonomyCategories?.nodes || [];

    return new Response(JSON.stringify({ categories }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching taxonomy categories:", error);
    return new Response(
      JSON.stringify({ categories: [], error: "Failed to fetch categories" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
