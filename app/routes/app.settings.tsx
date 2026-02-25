import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  BlockStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const storeConfiguration = await prisma.storeConfiguration.findUnique({
    where: { shop: session.shop },
  });

  return { elkoApiKey: storeConfiguration?.elkoApiKey || "" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const elkoApiKey = String(formData.get("elkoApiKey") || "");

  await prisma.storeConfiguration.upsert({
    where: { shop: session.shop },
    update: { elkoApiKey },
    create: { shop: session.shop, elkoApiKey },
  });

  return { status: "success" };
};

export default function Settings() {
  const { elkoApiKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [apiKey, setApiKey] = useState(elkoApiKey);

  const handleChange = useCallback((newValue: string) => setApiKey(newValue), []);

  return (
    <Page title="Elko Integration Settings">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {actionData?.status === "success" && (
              <Banner tone="success" title="Settings saved" />
            )}
            <Card>
              <Form method="post">
                <FormLayout>
                  <TextField
                    label="Elko API Key"
                    name="elkoApiKey"
                    value={apiKey}
                    onChange={handleChange}
                    autoComplete="off"
                  />
                  <Button submit variant="primary">
                    Save
                  </Button>
                </FormLayout>
              </Form>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
