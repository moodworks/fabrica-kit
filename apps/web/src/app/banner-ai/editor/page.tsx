import type { Metadata } from 'next';

import { BannerAiProjectEditor } from '../../../features/banner-ai/banner-ai-project-editor';

export const metadata: Metadata = {
  title: 'Provider-free Banner editor',
  description:
    'Edit the development-only preserved and replayed validated real Meta SAM automatic candidate 05; manually selected, with deterministic internal validation.',
};

export default function BannerAiEditorPage() {
  return <BannerAiProjectEditor />;
}
