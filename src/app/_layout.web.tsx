import { QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import Head from 'expo-router/head';
import { useSyncExternalStore } from 'react';

import { WebShell } from '@/components/web/WebShell';
import { queryClient } from '@/lib/queryClient';

import '../global.css';

const SITE_DESCRIPTION = 'XYZ is a live multi-market terminal for charts, watchlists, news, macro events and portfolio risk.';
const siteOrigin = process.env.EXPO_PUBLIC_SITE_ORIGIN?.replace(/\/$/, '') ?? 'https://site-origin.invalid';
const socialImage = `${siteOrigin}/og.png`;
const subscribeToClient = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export default function WebRootLayout() {
  // Browser preferences hydrate synchronously from local storage. Keep the
  // static export and initial client render identical before reading them.
  const clientReady = useSyncExternalStore(subscribeToClient, clientSnapshot, serverSnapshot);
  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <title>XYZ · Live market terminal</title>
        <meta name="description" content={SITE_DESCRIPTION} />
        <meta name="theme-color" content="#0B1114" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="XYZ · Live market terminal" />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        <meta property="og:image" content={socialImage} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="XYZ · Live market terminal" />
        <meta name="twitter:description" content={SITE_DESCRIPTION} />
        <meta name="twitter:image" content={socialImage} />
      </Head>
      {clientReady ? <WebShell>
        <Slot />
      </WebShell> : <div className="web-startup-state" role="status">Opening workspace…</div>}
    </QueryClientProvider>
  );
}
