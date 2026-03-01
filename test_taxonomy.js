import { createAdminApiClient } from '@shopify/admin-api-client';

const client = createAdminApiClient({
  storeDomain: 'test',
  apiVersion: '2025-01', // close to 2025-10
  accessToken: 'test',
});

// Since we can't easily mock the client to hit a real API without credentials, we can just look at how the query should be structured based on the search results.
