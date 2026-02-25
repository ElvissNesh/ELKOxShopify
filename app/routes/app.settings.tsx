import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  BlockStack,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const config = await prisma.storeConfiguration.findUnique({
    where: { shop },
  });

  return { config };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const elkoApiKey = formData.get("elkoApiKey") as string;

  if (!elkoApiKey) {
    return { error: "API Key is required" };
  }

  await prisma.storeConfiguration.upsert({
    where: { shop },
    update: { elkoApiKey },
    create: { shop, elkoApiKey },
  });

  return { success: true };
};

export default function Settings() {
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [elkoApiKey, setElkoApiKey] = useState(config?.elkoApiKey || "");

  const isLoading = navigation.state === "submitting";

  const handleSave = useCallback(() => {
    submit({ elkoApiKey }, { method: "post" });
  }, [elkoApiKey, submit]);

  return (
    <Page title="Elko Integration Settings">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {actionData?.error && (
                <Banner tone="critical">
                  <p>{actionData.error}</p>
                </Banner>
              )}
              {actionData?.success && (
                <Banner tone="success">
                  <p>Settings saved successfully.</p>
                </Banner>
              )}
              <FormLayout>
                <TextField
                  label="Elko API Key"
                  value={elkoApiKey}
                  onChange={setElkoApiKey}
                  autoComplete="off"
                />
                <Button onClick={handleSave} loading={isLoading} variant="primary">
                  Save Settings
                </Button>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
