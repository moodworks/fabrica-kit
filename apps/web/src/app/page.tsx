import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-card" aria-labelledby="home-title">
        <p className="eyebrow">Fabrica Kit · local product validation</p>
        <h1 id="home-title">Banner AI foundation</h1>
        <p>Inspect the provider-free composition workflow through the minimal local application.</p>
        <Link className="primary-link" href="/banner-ai">
          Open Banner AI
        </Link>
      </section>
    </main>
  );
}
