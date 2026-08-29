import { QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import Head from 'expo-router/head';

import { WebShell } from '@/components/web/WebShell';
import { queryClient } from '@/lib/queryClient';

import '../global.css';

const SITE_DESCRIPTION = 'A calm, live market workspace for watchlists, charts, news and portfolio risk.';
const siteOrigin = process.env.EXPO_PUBLIC_SITE_ORIGIN?.replace(/\/$/, '') ?? 'https://site-origin.invalid';
const socialImage = `${siteOrigin}/og.png`;

export default function WebRootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Head>
        <title>TradingView · Markets, without the noise.</title>
        <meta name="description" content={SITE_DESCRIPTION} />
        <meta name="theme-color" content="#080A0D" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="TradingView · Markets, without the noise." />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        <meta property="og:image" content={socialImage} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="TradingView · Markets, without the noise." />
        <meta name="twitter:description" content={SITE_DESCRIPTION} />
        <meta name="twitter:image" content={socialImage} />
      </Head>
      <WebShell>
        <Slot />
      </WebShell>
    </QueryClientProvider>
  );
}
