import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useSubmit, useNavigation, Form } from "react-router";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  BlockStack,
  Banner,
  List,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { syncElkoProducts } from "../utils/elko.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const elkoIdsString = formData.get("elkoIds") as string;

  if (!elkoIdsString) {
    return { status: "error", message: "Please provide ELKO product codes.", errors: [] };
  }

  const elkoIds = elkoIdsString.split(",").map((id) => id.trim()).filter((id) => id.length > 0);

  if (elkoIds.length === 0) {
    return { status: "error", message: "Please provide valid ELKO product codes.", errors: [] };
  }

  const result = await syncElkoProducts(session.shop, elkoIds, admin);

  if (result.errors.length > 0 && result.success === 0) {
     return { status: "error", message: "Failed to sync products.", errors: result.errors };
  } else if (result.errors.length > 0 && result.success > 0) {
      return {
          status: "partial",
          message: `Successfully synced ${result.success} products with some errors.`,
          errors: result.errors
      };
  }

  return { status: "success", message: `Successfully synced ${result.success} products.`, errors: [] };
};

export default function ImportPage() {
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [elkoIds, setElkoIds] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); // Prevent default form submission
    submit({ elkoIds }, { method: "post" });
  };

  return (
    <Page title="Product Import">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {actionData?.status === "success" && (
              <Banner tone="success" title="Import Successful">
                <p>{actionData.message}</p>
              </Banner>
            )}
            {actionData?.status === "partial" && (
              <Banner tone="warning" title="Import Completed with Errors">
                <p>{actionData.message}</p>
                <List type="bullet">
                    {actionData.errors?.map((error: string, index: number) => (
                        <List.Item key={index}>{error}</List.Item>
                    ))}
                </List>
              </Banner>
            )}
            {actionData?.status === "error" && (
              <Banner tone="critical" title="Import Failed">
                <p>{actionData.message}</p>
                 {actionData.errors && actionData.errors.length > 0 && (
                    <List type="bullet">
                        {actionData.errors.map((error: string, index: number) => (
                            <List.Item key={index}>{error}</List.Item>
                        ))}
                    </List>
                 )}
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <p>
                  Enter comma-separated ELKO product codes to sync them into Shopify.
                  Existing products with the same ELKO ID will be updated.
                </p>
                <Form method="post" onSubmit={handleSubmit}>
                    <BlockStack gap="400">
                        <TextField
                        label="ELKO Product Codes"
                        value={elkoIds}
                        onChange={setElkoIds}
                        multiline={4}
                        autoComplete="off"
                        placeholder="12345, 67890, 11223"
                        helpText="Separate multiple codes with commas."
                        />
                        <Button submit loading={isLoading} variant="primary">
                        Import Products
                        </Button>
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
