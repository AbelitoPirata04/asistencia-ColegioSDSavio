# Control de asistencia · Colegio Santo Domingo Savio

Sistema de control de asistencia biométrico y fotográfico para docentes y directivos.

Un equipo con **ESP32-S3** (sensor de huella R307, lector RFID RC522, cámara, pantalla LCD 16x2, reloj DS3231 y buzzer)
registra la llegada y la salida de cada persona, le toma una foto y lo envía a un **panel web** donde el administrador
gestiona al personal, revisa la asistencia y descarga reportes.

## Qué hace

- **Docentes y directivos:** registro con foto, nivel, grado o asignatura; asignación de huella y tarjeta desde el panel.
- **Asistencias:** llegada y salida por día, retardos, quién no llegó, fotos de cada pase, historial por persona.
- **Registro manual:** para corregir fallas del equipo u olvidos (queda marcado y con motivo).
- **Novedades:** permisos e incapacidades (ausencias justificadas) y días sin clase (festivos de Colombia incluidos).
- **Reportes:** PDF y Excel por día, semana, mes o rango de fechas.
- **Avisos en vivo:** notificación y voz en el panel cuando alguien marca en el equipo.
- **Carnet:** impresión en tamaño tarjeta (CR80) con la foto de la persona.

## Tecnologías

| Parte | Tecnología |
|---|---|
| Servidor | Node.js 24 + Express 5 |
| Vistas | EJS + CSS propio (sin frameworks) |
| Base de datos | MySQL / MariaDB (XAMPP) |
| Reportes | pdfkit y exceljs |
| Equipo | ESP32-S3 programado con Arduino IDE |

## Instalación

1. **Base de datos:** en phpMyAdmin cree la base `bd_asistencia_savio` e importe [`sql/esquema_completo.sql`](sql/esquema_completo.sql).
2. **Configuración:** copie `.env.ejemplo` como `.env` y ajuste los datos de MySQL.
3. **Servidor:**
   ```
   npm install
   node --watch servidor.js
   ```
   Abra `http://localhost:3000`.
4. **Equipo ESP32:** en `arduino/asistencia_savio/` copie `secretos.ejemplo.h` como `secretos.h`, ponga la red WiFi y la IP
   del computador donde corre el servidor, y suba `asistencia_savio.ino` con Arduino IDE
   (placa *ESP32S3 Dev Module*, PSRAM *OPI PSRAM*).

## Estructura

```
servidor.js            API que usa el ESP32 (/api/...)
routes/panel.js        Vistas y API del panel (/admin/api/...)
servicios/             Lógica compartida: asistencias, reportes, equipo, festivos
views/                 Páginas (EJS)
public/                CSS, JavaScript del navegador e imágenes
sql/                   Esquema completo y migraciones
arduino/               Código del ESP32
scripts/               Restablecer la contraseña del panel
```

## Acceso al panel

Solo entran los encargados de asistencia (rol administrador), con correo y contraseña.
Desde **Mi cuenta** se cambia la contraseña y se da o quita acceso a otros encargados.
Si nadie puede entrar:

```
node scripts/restablecer_clave.js correo@savio.edu.co ClaveTemporal123
```

## Pendiente

- Configuración del WiFi del equipo sin reprogramarlo (portal WiFiManager).
- Respaldo en tarjeta MicroSD cuando no hay internet.
