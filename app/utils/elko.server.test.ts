
import { syncElkoProducts } from "./elko.server";
import prisma from "../db.server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks
vi.mock("../db.server", () => ({
  default: {
    storeConfiguration: {
      findUnique: vi.fn(),
    },
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockAdmin = {
  graphql: vi.fn(),
};

describe("syncElkoProducts", () => {
  const shop = "test-shop.myshopify.com";
  const elkoIds = ["123", "456"];
  const apiKey = "test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.storeConfiguration.findUnique as any).mockResolvedValue({
      shop,
      elkoApiKey: apiKey,
      locationId: null, // Default: no location configured
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    mockAdmin.graphql.mockResolvedValue({
        json: async () => ({
            data: {
                locations: {
                    nodes: [{ id: "gid://shopify/Location/111" }]
                }
            }
        })
    });
  });

  afterEach(() => {
      vi.restoreAllMocks();
  });

  it("should fail if API key is missing", async () => {
    (prisma.storeConfiguration.findUnique as any).mockResolvedValue(null);

    const result = await syncElkoProducts(shop, elkoIds, mockAdmin);

    expect(result.errors).toContain("ELKO API Key not configured.");
  });

  it("should use primary location if no location configured", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    await syncElkoProducts(shop, elkoIds, mockAdmin);

    // Verify location fetch was called
    expect(mockAdmin.graphql).toHaveBeenCalledWith(
      expect.stringContaining("locations(first: 1)")
    );
  });

  it("should use configured location if present", async () => {
     (prisma.storeConfiguration.findUnique as any).mockResolvedValue({
      shop,
      elkoApiKey: apiKey,
      locationId: "gid://shopify/Location/999", // Configured location
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ elkoCode: "123", title: "Test Product" }], // Return one product to trigger processing
    });

    // Mock responses for subsequent calls
     mockAdmin.graphql
        .mockResolvedValueOnce({ // check existing product
            json: async () => ({ data: { products: { edges: [] } } })
        })
        .mockResolvedValueOnce({ // create product
             json: async () => ({ data: { productCreate: { product: { id: "gid://shopify/Product/101", variants: { nodes: [{ id: "gid://shopify/ProductVariant/202" }] } } } } })
        })
         .mockResolvedValueOnce({ // set metafields
             json: async () => ({ data: { metafieldsSet: { userErrors: [] } } })
        });


    await syncElkoProducts(shop, elkoIds, mockAdmin);

    // Verify location fetch was NOT called
    expect(mockAdmin.graphql).not.toHaveBeenCalledWith(
      expect.stringContaining("locations(first: 1)")
    );
  });
});
