# IZZA Smart

Aplicación administrativa de IZZA Servicios de Mantenimiento. Incluye clientes, agenda, cotizaciones, órdenes de servicio, materiales, pagos, técnicos, usuarios y evidencias. La aplicación usa **Next.js 16 (App Router)** y **Supabase** para autenticación, base de datos y archivos.

## Requisitos

- Node.js 20.9 o superior (recomendado: Node.js 22 LTS).
- npm 10 o superior.
- Acceso al proyecto actual de Supabase.

## Instalación local

1. Duplica `.env.example` como `.env.local`.
2. Completa las variables con los valores del proyecto actual de Supabase.
3. Ejecuta `npm ci`.
4. Ejecuta `npm run dev`.
5. Abre `http://localhost:3000`.

Comandos disponibles:

- `npm run dev`: servidor local de desarrollo.
- `npm run build`: compilación de producción.
- `npm start`: ejecuta la compilación de producción.
- `npm test`: pruebas automáticas sin modificar Supabase.
- `npm run lint`: revisión estática del código.

## Variables de entorno

Consulta `.env.example`. La clave `SUPABASE_SERVICE_ROLE_KEY` es exclusiva del servidor. Nunca debe llevar el prefijo `NEXT_PUBLIC_`, aparecer en código del cliente, guardarse en Git ni incluirse en el ZIP.

`NEXT_PUBLIC_SUPABASE_ANON_KEY` puede usarse en el navegador porque Supabase aplica autenticación y políticas RLS. No sustituye la necesidad de mantener RLS correctamente configurado.

## Supabase existente

La aplicación sigue apuntando al proyecto de Supabase que se configure mediante variables de entorno. Esta migración de alojamiento no borra ni modifica datos existentes.

El archivo `supabase/migrations/20260803_vercel_properties.sql` contiene únicamente estructuras aditivas para reemplazar el almacenamiento exclusivo de ChatGPT Sites en el módulo de propiedades. Revísalo y ejecútalo una sola vez en el SQL Editor de Supabase antes de usar ese módulo en Vercel. No elimina tablas ni registros.

## Despliegue en Vercel

1. Sube el contenido de esta carpeta a un repositorio privado.
2. En Vercel, importa el repositorio.
3. Usa el preset **Next.js**.
4. Define como directorio raíz la carpeta que contiene este `package.json` (si el repositorio contiene únicamente IZZA Smart, deja `Root Directory` vacío).
5. Configura todas las variables de `.env.example` en Project Settings → Environment Variables.
6. Mantén `SUPABASE_SERVICE_ROLE_KEY` como secreto sólo del servidor.
7. Despliega. Vercel ejecutará `npm ci` y `npm run build`.
8. Actualiza `NEXT_PUBLIC_SITE_URL` con el dominio definitivo y vuelve a desplegar.

No se requiere crear un proyecto de Vercel ni un repositorio para ejecutar o verificar este paquete localmente.

## Seguridad

- Los archivos `.env*` están ignorados, excepto `.env.example`.
- El código del navegador no contiene claves reales integradas.
- Las operaciones administrativas del servidor validan el token de Supabase antes de usar la clave de servicio.
- No incluyas `.next`, `node_modules`, `.git`, archivos de entorno ni credenciales en entregables.
