"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("IZZA Smart render error", error);
  }, [error]);

  return <main className="login-page">
    <section className="login-card auth-error-card" role="alert">
      <h1>IZZA Smart no pudo cargar</h1>
      <p>Ocurrió un error inesperado, pero tus datos permanecen seguros.</p>
      <button className="primary-button" onClick={reset}>Intentar de nuevo</button>
    </section>
  </main>;
}
