/**
 * @file  apps/web/app/terms/page.tsx
 * @area  Legal
 * @what  Terms of Service page (public): renders docs/legal/TERMS_OF_SERVICE.md; shows a draft notice while the text is under legal review.
 */
import type { Metadata } from 'next';
import { legalHtml } from '@/lib/legal';
import '../blog.css';

export const metadata: Metadata = { title: 'Terms of Service · PnL Lens', robots: { index: false, follow: true } };

export default function Page() {
  const { html, draft } = legalHtml('TERMS_OF_SERVICE.md');
  return (
    <div className="bl">
      <article className="bl-article legal">
        {draft && <p className="legal-draft" role="note">Draft — under legal review. The final version will be published before launch.</p>}
        <div className="bl-body" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  );
}
