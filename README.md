# CONTROL

Control de gastos personales (PWA para iPhone/iPad). Sin servidor, sin cuentas, sin conexión a bancos.
Los datos se guardan solo en el dispositivo (IndexedDB). El respaldo es un archivo que guarda el propietario.

Versión: 1.1.5 (prueba)

## Archivos
`index.html` · `app.js` (interfaz y almacenamiento) · `core.js` (lógica) · `xlsx.js` (exportar Excel) · `vault.js` (cifrado de respaldos) · `sw.js` (uso sin conexión) · `manifest.webmanifest` · `icons/`

Todas las rutas son relativas, por lo que funciona en `https://<usuario>.github.io/control-navas/`.

## Publicar en GitHub Pages
Settings → Pages → Source: *Deploy from a branch* → rama `main`, carpeta `/ (root)`.

## Publicar una corrección
1. Subir los archivos modificados.
2. Cambiar el mismo número en `sw.js` (`VERSION`) y en `app.js` (`APP_VERSION`). Sin este cambio, los teléfonos con la app instalada no recibirán la actualización.
3. En el teléfono: cerrar la app por completo y abrirla dos veces. La versión se ve en Ajustes → Estado de CONTROL.

## Importante
- No guardar datos personales ni respaldos en este repositorio.
- Borrar el icono de la pantalla de inicio borra los datos locales de la app. Hacer un respaldo antes.
