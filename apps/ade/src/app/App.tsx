import { useEffect } from "react";
import { IntlProvider } from "react-intl";

import { bindConnection } from "../features/connection";
import { chooseLocale, defaultLocale, messagesFor } from "../i18n/catalog";
import type { SessionHostClient } from "../platform/session-host";
import { Frame } from "./Frame";
import { SessionHostProvider } from "./session-host-context";

const locale = chooseLocale(navigator.languages);

/** The application root: the catalog, the session-host client, and the frame. */
export function App(props: { client: SessionHostClient }) {
  const { client } = props;
  useEffect(() => {
    const unbind = bindConnection(client);
    client.start();
    return unbind;
  }, [client]);
  return (
    <IntlProvider locale={locale} defaultLocale={defaultLocale} messages={messagesFor(locale)}>
      <SessionHostProvider client={client}>
        <Frame />
      </SessionHostProvider>
    </IntlProvider>
  );
}
