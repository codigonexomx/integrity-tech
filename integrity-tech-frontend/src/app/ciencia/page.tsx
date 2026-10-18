import Link from 'next/link';
export default function PilotScope() {
  return <main className="mx-auto max-w-3xl px-6 py-16 text-slate-200">
    <Link href="/" className="text-indigo-300">← Inicio</Link>
    <h1 className="mt-8 text-3xl font-semibold">Alcance del piloto</h1>
    <p className="mt-6 leading-relaxed">Integrity Tech administra evaluaciones, conserva respuestas y presenta reportes descriptivos. El piloto busca comprobar el proceso y su utilidad.</p>
    <h2 className="mt-8 text-xl font-semibold">Interpretación responsable</h2>
    <p className="mt-4 leading-relaxed">Los cuestionarios experimentales no tienen baremos poblacionales ni validez predictiva acreditada. Sus puntuaciones no son percentiles o probabilidades de desempeño y no permiten concluir si una persona es honesta. No deben usarse para aceptar o rechazar candidatos.</p>
    <p className="mt-4 leading-relaxed">Los resultados de la versión de integridad retirada no son interpretables. Las prácticas incluidas solo permiten probar el funcionamiento; no miden aptitud laboral.</p>
    <h2 className="mt-8 text-xl font-semibold">Contenido y datos</h2>
    <p className="mt-4 leading-relaxed">Cada organización debe utilizar contenido propio o autorizado, informar la finalidad y fijar acceso y retención de datos. Las rúbricas de evaluaciones prácticas requieren revisión antes de usarse en selección.</p>
    <p className="mt-4 leading-relaxed">La calibración automática y LTI no están disponibles en el piloto. La cámara está desactivada por defecto.</p>
  </main>;
}
