import type { Metadata } from 'next';

import { BannerAiClient } from '../../features/banner-ai/banner-ai-client';

export const metadata: Metadata = {
  title: 'Banner AI',
  description: 'Run a local, provider-free Banner AI composition fixture.',
};

export default function BannerAiPage() {
  return <BannerAiClient />;
}
