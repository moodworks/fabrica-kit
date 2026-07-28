import type { Metadata } from 'next';

import { BannerAiProjectEditor } from '../../../features/banner-ai/banner-ai-project-editor';

export const metadata: Metadata = {
  title: 'Provider-free Banner editor',
  description: 'Edit, preview, export, and internally validate the approved local Angel fixture.',
};

export default function BannerAiEditorPage() {
  return <BannerAiProjectEditor />;
}
