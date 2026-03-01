import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";

  try {
    let graphqlQuery = "";
    let variables = {};

    if (!query || query.length < 2) {
      // Return top-level root categories if search is empty
      graphqlQuery = `query {
        taxonomy {
          categories(first: 20) {
            nodes {
              id
              fullName
            }
          }
        }
      }`;
    } else {
      // Return categories matching search query
      graphqlQuery = `query taxonomyCategories($query: String!) {
        taxonomy {
          categories(first: 20, query: $query) {
            nodes {
              id
              fullName
            }
          }
        }
      }`;
      variables = { query: query };
    }

    const response = await admin.graphql(graphqlQuery, { variables });

    const responseJson = await response.json();
    const categories = responseJson.data?.taxonomy?.categories?.nodes || [];

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
