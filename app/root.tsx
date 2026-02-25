import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import translations from "@shopify/polaris/locales/en.json";

// We are NOT importing the CSS here to stop the "Module Not Found" error.
// The Polaris Provider will handle the component logic.

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <PolarisProvider i18n={translations}>
          <Outlet />
        </PolarisProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
