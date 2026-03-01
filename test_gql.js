import fs from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  const session = await prisma.session.findFirst();

  if (!session) {
    console.log("No session found in DB");
    return;
  }

  const token = session.accessToken;
  const shop = session.shop;

  const query = `
    query {
      taxonomy {
        categories(first: 20) {
          nodes {
            id
            name
            fullName
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

run();
