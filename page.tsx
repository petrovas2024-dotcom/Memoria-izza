"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="es"><body>
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#06233F", fontFamily: "Arial, sans-serif" }}>
      <section role="alert" style={{ width: "min(430px, 100%)", padding: 32, borderRadius: 18, background: "#fff", color: "#06233F", textAlign: "center" }}>
        <h1>IZZA Smart no pudo cargar</h1>
        <p style={{ color: "#516473" }}>La aplicación encontró un error, pero no se modificó ningún dato.</p>
        <button onClick={reset} style={{ width: "100%", height: 44, border: 0, borderRadius: 8, background: "#E3A51A", color: "#06233F", fontWeight: 800 }}>Intentar de nuevo</button>
      </section>
    </main>
  </body></html>;
}
