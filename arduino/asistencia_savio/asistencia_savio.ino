/*
  Control de asistencia · Colegio Santo Domingo Savio
  ESP32-S3 + R307 (huella) + RC522 (RFID) + LCD 16x2 I2C + DS3231 + cámara + buzzer

  El programa trabaja en 3 tareas al mismo tiempo, para que la pantalla y los sensores
  NUNCA se queden esperando a la red:

    loop()       (núcleo 1) -> pantalla, huella, tarjeta, buzzer
    tareaRed     (núcleo 0) -> pregunta el modo cada 2 s y envía asistencias / registros
    tareaFotos   (núcleo 0) -> sube las fotos en segundo plano (con reintentos)

  Modos que manda el servidor:
    asistencia -> huella o tarjeta marcan la llegada (y se toma la foto)
    registro   -> guarda una huella nueva en el sensor con el ID que manda el panel
    tarjeta    -> la próxima tarjeta que se pase queda asignada a la persona elegida en el panel

  Rutas del servidor (servidor.js):
    GET  /api/modo                -> {"modo":"...","id":3,"nombre_lcd":"Carlos Andres"}
    POST /api/asistencias         -> {"tipo":"huella|rfid","identificador":"..."} -> {"id_asistencia":12,...}
    POST /api/tarjeta-leida       -> {"uid":"A1B2C3D4"}
    GET  /api/huella-estado?id=5
    GET  /api/registro-exitoso
    POST /api/fotos?tipo=..&identificador=..&id_asistencia=..   (cuerpo = foto JPEG)
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <RTClib.h>
#include <Adafruit_Fingerprint.h>
#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <time.h>
#include "esp_camera.h"

// ======================= CONFIGURACIÓN (lo único que normalmente se cambia) =======================
// La red WiFi y la dirección del servidor están en "secretos.h" (no se sube a GitHub).
// Si no existe: copie "secretos.ejemplo.h" como "secretos.h" y ponga sus datos.
#include "secretos.h"
String SERVIDOR = SERVIDOR_URL;

#define ENVIAR_FOTO     true    // false = no manda fotos al servidor
#define CAMARA_GIRADA   true    // true = la cámara está montada al revés: gira la foto 180°
#define BUZZER_ACTIVO   false   // true = buzzer activo, false = buzzer pasivo
#define LECTURAS_HUELLA 2       // veces que se pone el dedo al registrar (2 = huella más completa)

// ======================= PINES =======================
#define SDA_PIN 1
#define SCL_PIN 2
#define SENSOR_RX_PIN 41
#define SENSOR_TX_PIN 42
#define SS_PIN 21
#define RST_PIN 14
#define SCK_PIN 39
#define MISO_PIN 40
#define MOSI_PIN 38
#define BUZZER_PIN 47

// Cámara (Freenove ESP32-S3 WROOM CAM / ESP32S3_EYE)
#define CAM_PWDN  -1
#define CAM_RESET -1
#define CAM_XCLK  15
#define CAM_SIOD   4
#define CAM_SIOC   5
#define CAM_Y9    16
#define CAM_Y8    17
#define CAM_Y7    18
#define CAM_Y6    12
#define CAM_Y5    10
#define CAM_Y4     8
#define CAM_Y3     9
#define CAM_Y2    11
#define CAM_VSYNC  6
#define CAM_HREF   7
#define CAM_PCLK  13

// ======================= OBJETOS =======================
LiquidCrystal_I2C lcd(0x27, 16, 2);
RTC_DS3231 rtc;
HardwareSerial fSerial(1);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fSerial);
MFRC522 rfid(SS_PIN, RST_PIN);
WebServer server(80);

// ======================= ESTADO COMPARTIDO ENTRE TAREAS =======================
enum { MODO_ASISTENCIA = 0, MODO_REGISTRO = 1, MODO_TARJETA = 2 };
volatile int modoActual = MODO_ASISTENCIA;
volatile int idHuellaRegistrar = 0;
volatile bool cambioModo = false;              // la tareaRed avisa al loop para que suene el bip
volatile bool servidorOK = false;              // false = la pantalla muestra "Sin servidor"
volatile unsigned long ultimaRespuesta = 0;
volatile unsigned long ignorarModoHasta = 0;   // tras terminar un registro, ignora respuestas viejas
volatile bool reinicioPedido = false;          // el encargado pidió reiniciar desde el panel

// Mensajes entre el loop y la tareaRed
struct Peticion  { uint32_t n; char metodo[6]; char ruta[96]; char cuerpo[160]; };
struct Respuesta { uint32_t n; int codigo; char cuerpo[320]; };
struct Foto      { uint8_t *datos; size_t largo; int idAsistencia; bool salida; char tipo[8]; char id[24]; };

QueueHandle_t colaPeticion, colaRespuesta, colaFotos;
uint32_t numeroPeticion = 0;

bool camaraOK = false;
bool huellaOK = false;
unsigned long ultimoSensor = 0;
unsigned long ultimoRefrescoLcd = 0;
String ultimaTarjeta = "";
unsigned long ultimaTarjetaMs = 0;

// Confirmación de salida: si alguien pasa dos veces en menos de 3 min, debe pasar otra vez
// (en los siguientes 15 s) para confirmar que de verdad se va
#define VENTANA_CONFIRMAR_MS 15000
String confirmarId = "";
unsigned long confirmarHasta = 0;

// ======================= UTILIDADES JSON =======================
// {"nombre_lcd":"Carlos"} -> Carlos
String campoJson(const String &json, const String &clave) {
  String buscar = "\"" + clave + "\":\"";
  int i = json.indexOf(buscar);
  if (i < 0) return "";
  i += buscar.length();
  int f = json.indexOf('"', i);
  return f < 0 ? "" : json.substring(i, f);
}

// {"id":3} -> 3   ({"id":null} -> 0)
int campoNumero(const String &json, const String &clave) {
  String buscar = "\"" + clave + "\":";
  int i = json.indexOf(buscar);
  if (i < 0) return 0;
  return json.substring(i + buscar.length()).toInt();
}

// ======================= RED (se usa SOLO dentro de las tareas de red) =======================
// Reutiliza la misma conexión con el servidor (mucho más rápido que abrir una nueva cada vez).
// Si la conexión guardada se cayó, reintenta una vez con una conexión nueva.
int enviarHttp(HTTPClient &http, WiFiClient &cliente, const char *metodo, const String &ruta,
               const uint8_t *datos, size_t largo, const char *tipo, String &resp, uint16_t espera) {
  resp = "";
  for (int intento = 0; intento < 2; intento++) {
    if (WiFi.status() != WL_CONNECTED) return -100;
    http.setReuse(true);
    http.setConnectTimeout(3000);
    http.setTimeout(espera);
    if (!http.begin(cliente, SERVIDOR + ruta)) return -101;
    int codigo;
    if (strcmp(metodo, "POST") == 0) {
      http.addHeader("Content-Type", tipo);
      codigo = http.POST((uint8_t *)datos, largo);
    } else {
      codigo = http.GET();
    }
    if (codigo > 0) resp = http.getString();
    http.end();
    // -1..-4 = falló ANTES de que el servidor recibiera la petición: es seguro reintentar
    if (codigo <= -1 && codigo >= -4) { cliente.stop(); continue; }
    if (codigo < 0) cliente.stop();
    return codigo;
  }
  return -1;
}

void consultarModo(HTTPClient &http, WiFiClient &cliente) {
  String r;
  int codigo = enviarHttp(http, cliente, "GET", "/modo", nullptr, 0, "", r, 3000);
  if (codigo != 200) {
    if (millis() - ultimaRespuesta > 7000) servidorOK = false;
    return;
  }
  servidorOK = true;
  ultimaRespuesta = millis();
  if (r.indexOf("\"reiniciar\":true") >= 0) reinicioPedido = true;   // botón "Reiniciar equipo" del panel
  if ((long)(ignorarModoHasta - millis()) > 0) return;

  String m = campoJson(r, "modo");
  int nuevo = (m == "registro") ? MODO_REGISTRO : (m == "tarjeta") ? MODO_TARJETA : MODO_ASISTENCIA;
  idHuellaRegistrar = campoNumero(r, "id");
  if (nuevo != modoActual) {
    Serial.printf("[MODO] %d -> %d\n", modoActual, nuevo);
    modoActual = nuevo;
    cambioModo = true;
  }
}

// Tarea 1: peticiones del loop (prioridad) y consulta del modo cada 2 s
void tareaRed(void *) {
  WiFiClient cliente;
  HTTPClient http;
  unsigned long ultimoModo = 0;
  Peticion p;
  for (;;) {
    if (xQueueReceive(colaPeticion, &p, pdMS_TO_TICKS(20)) == pdTRUE) {
      String r;
      Respuesta out;
      out.n = p.n;
      out.codigo = enviarHttp(http, cliente, p.metodo, String(p.ruta),
                              (const uint8_t *)p.cuerpo, strlen(p.cuerpo), "application/json", r, 5000);
      if (out.codigo > 0) { servidorOK = true; ultimaRespuesta = millis(); }
      strlcpy(out.cuerpo, r.c_str(), sizeof(out.cuerpo));
      xQueueOverwrite(colaRespuesta, &out);
      continue;
    }
    if (millis() - ultimoModo >= 2000) {
      ultimoModo = millis();
      consultarModo(http, cliente);
    }
  }
}

// Tarea 2: sube las fotos sin frenar al equipo. Hasta 3 intentos por foto.
void tareaFotos(void *) {
  WiFiClient cliente;
  HTTPClient http;
  Foto f;
  for (;;) {
    if (xQueueReceive(colaFotos, &f, portMAX_DELAY) != pdTRUE) continue;
    String ruta = "/fotos?tipo=" + String(f.tipo) + "&identificador=" + String(f.id) +
                  "&id_asistencia=" + String(f.idAsistencia) + (f.salida ? "&momento=salida" : "");
    int codigo = -1;
    String r;
    for (int i = 0; i < 3 && codigo != 200; i++) {
      unsigned long t = millis();
      codigo = enviarHttp(http, cliente, "POST", ruta, f.datos, f.largo, "image/jpeg", r, 15000);
      Serial.printf("[CAM] Foto %u bytes, intento %d -> %d (%lu ms)\n",
                    (unsigned)f.largo, i + 1, codigo, millis() - t);
      if (codigo != 200) vTaskDelay(pdMS_TO_TICKS(800));
    }
    free(f.datos);
  }
}

// Desde el loop: pide algo al servidor por medio de la tareaRed y espera la respuesta
#define ESPERA_RED 7000   // máximo que la pantalla espera una respuesta del servidor (ms)
int pedir(const char *metodo, const String &ruta, const String &cuerpo, String &resp) {
  const unsigned long esperaMs = ESPERA_RED;
  Peticion p;
  p.n = ++numeroPeticion;
  strlcpy(p.metodo, metodo, sizeof(p.metodo));
  strlcpy(p.ruta, ruta.c_str(), sizeof(p.ruta));
  strlcpy(p.cuerpo, cuerpo.c_str(), sizeof(p.cuerpo));
  if (xQueueSend(colaPeticion, &p, pdMS_TO_TICKS(500)) != pdTRUE) return -300;
  Respuesta r;
  unsigned long t = millis();
  while (millis() - t < esperaMs) {
    if (xQueueReceive(colaRespuesta, &r, pdMS_TO_TICKS(30)) == pdTRUE && r.n == p.n) {
      resp = r.cuerpo;
      return r.codigo;
    }
  }
  return -200;   // la red no respondió a tiempo
}

// ======================= PANTALLA =======================
String lcdTexto[2] = {"", ""};   // lo que hay en pantalla, para no reescribir si no cambia

void lcdLinea(int fila, String texto) {
  while (texto.length() < 16) texto += " ";
  if (texto.length() > 16) texto = texto.substring(0, 16);
  if (texto == lcdTexto[fila]) return;
  lcd.setCursor(0, fila);
  lcd.print(texto);
  lcdTexto[fila] = texto;
}

void mostrar(String l0, String l1) {
  lcdLinea(0, l0);
  lcdLinea(1, l1);
}

// Reinicia el bus I2C y la LCD (limpia la "basura" que a veces deja el ruido del WiFi)
void reiniciarLcd() {
  Wire.end();
  delay(10);
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);
  Wire.setTimeOut(100);
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcdTexto[0] = lcdTexto[1] = "";
  ultimoRefrescoLcd = millis();
}

String dosDigitos(int n) { return (n < 10 ? "0" : "") + String(n); }

String horaActual() {
  DateTime now = rtc.now();
  return dosDigitos(now.hour()) + ":" + dosDigitos(now.minute());
}

// ======================= BUZZER =======================
void tono(int frecuencia, int duracionMs) {
  if (BUZZER_ACTIVO) {
    digitalWrite(BUZZER_PIN, HIGH); delay(duracionMs); digitalWrite(BUZZER_PIN, LOW);
    return;
  }
  long periodoUs = 1000000L / frecuencia;
  long ciclos = (long)duracionMs * 1000L / periodoUs;
  for (long i = 0; i < ciclos; i++) {
    digitalWrite(BUZZER_PIN, HIGH); delayMicroseconds(periodoUs / 2);
    digitalWrite(BUZZER_PIN, LOW);  delayMicroseconds(periodoUs / 2);
  }
  digitalWrite(BUZZER_PIN, LOW);
}
void beepCorto()    { tono(2400, 70); }
void beepOK()       { tono(2700, 180); }
void beepDenegado() { tono(800, 180); delay(70); tono(500, 350); }
void beepError()    { tono(1500, 150); delay(80); tono(1500, 150); }
void beepArranque() { tono(1800, 100); delay(50); tono(2300, 100); delay(50); tono(2700, 160); }

// ======================= CÁMARA =======================
bool iniciarCamara() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = CAM_Y2;  config.pin_d1 = CAM_Y3;  config.pin_d2 = CAM_Y4;  config.pin_d3 = CAM_Y5;
  config.pin_d4 = CAM_Y6;  config.pin_d5 = CAM_Y7;  config.pin_d6 = CAM_Y8;  config.pin_d7 = CAM_Y9;
  config.pin_xclk = CAM_XCLK;
  config.pin_pclk = CAM_PCLK;
  config.pin_vsync = CAM_VSYNC;
  config.pin_href = CAM_HREF;
  config.pin_sscb_sda = CAM_SIOD;   // si tu core da error aquí, cambia a pin_sccb_sda
  config.pin_sscb_scl = CAM_SIOC;   // y a pin_sccb_scl
  config.pin_pwdn = CAM_PWDN;
  config.pin_reset = CAM_RESET;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_VGA;   // 640x480: se ve bien la cara y pesa poco
  config.jpeg_quality = 13;
  config.fb_count = 2;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;

  if (!psramFound()) {
    Serial.println("[CAM] SIN PSRAM: revisa Herramientas > PSRAM > OPI PSRAM");
    config.frame_size = FRAMESIZE_QVGA;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  if (esp_camera_init(&config) != ESP_OK) {
    Serial.println("[CAM] Error al iniciar");
    return false;
  }
  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_whitebal(s, 1); s->set_awb_gain(s, 1); s->set_gain_ctrl(s, 1);
    s->set_exposure_ctrl(s, 1); s->set_aec2(s, 1); s->set_lenc(s, 0);
    s->set_brightness(s, 1); s->set_saturation(s, 0);
    s->set_vflip(s, CAMARA_GIRADA ? 1 : 0);     // voltea de arriba a abajo
    s->set_hmirror(s, CAMARA_GIRADA ? 1 : 0);   // y de izquierda a derecha (juntos = 180°)
  }
  return true;
}

// Página de prueba: abre http://IP-DEL-ESP32/ en el navegador para ver la cámara
void paginaCamara() {
  server.send(200, "text/html",
    "<html><body style='background:#111;color:#fff;text-align:center;font-family:sans-serif'>"
    "<h3>Prueba de camara</h3><img id='f' src='/foto' style='max-width:95%'>"
    "<script>setInterval(function(){document.getElementById('f').src='/foto?'+Date.now();},700);</script>"
    "</body></html>");
}

void fotoEnVivo() {
  if (!camaraOK) { server.send(503, "text/plain", "Camara no disponible"); return; }
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { server.send(500, "text/plain", "Error al capturar"); return; }
  server.sendHeader("Cache-Control", "no-store");
  server.send_P(200, "image/jpeg", (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// Toma la foto y la COPIA a memoria propia, así la cámara queda libre de inmediato
Foto tomarFoto(const String &tipo, const String &id) {
  Foto f;
  memset(&f, 0, sizeof(f));
  if (!camaraOK || !ENVIAR_FOTO) return f;
  camera_fb_t *viejo = esp_camera_fb_get();           // descarta el cuadro viejo del búfer
  if (viejo) esp_camera_fb_return(viejo);
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { Serial.println("[CAM] No se pudo capturar"); return f; }
  f.datos = (uint8_t *)(psramFound() ? ps_malloc(fb->len) : malloc(fb->len));
  if (f.datos) {
    memcpy(f.datos, fb->buf, fb->len);
    f.largo = fb->len;
  }
  esp_camera_fb_return(fb);
  strlcpy(f.tipo, tipo.c_str(), sizeof(f.tipo));
  strlcpy(f.id, id.c_str(), sizeof(f.id));
  return f;
}

// ======================= HUELLA =======================
bool esperarDedo(unsigned long ms) {
  unsigned long t = millis();
  while (millis() - t < ms) {
    if (finger.getImage() == FINGERPRINT_OK) return true;
    delay(40);
  }
  return false;
}

bool esperarSinDedo(unsigned long ms) {
  unsigned long t = millis();
  while (millis() - t < ms) {
    if (finger.getImage() == FINGERPRINT_NOFINGER) return true;
    delay(40);
  }
  return false;
}

// Asistencia: >0 = ID encontrado, -1 = huella no registrada, 0 = no hay dedo
int leerHuella() {
  if (finger.getImage() != FINGERPRINT_OK) return 0;
  if (finger.image2Tz() != FINGERPRINT_OK) return 0;
  if (finger.fingerSearch() == FINGERPRINT_OK) return finger.fingerID;
  return -1;
}

void falloRegistro(String l0, String l1) {
  mostrar(l0, l1);
  beepError();
  delay(1500);
  reiniciarLcd();
}

// Vuelve a modo asistencia sin esperar a la próxima consulta al servidor
void volverAsistencia() {
  modoActual = MODO_ASISTENCIA;
  ignorarModoHasta = millis() + 3000;
}

// Registro de huella nueva (modo "registro"). Devuelve true si quedó guardada.
bool registrarHuella(int id) {
  if (finger.getImage() != FINGERPRINT_OK) return false;      // todavía no ponen el dedo
  // El ID tiene que caber en la memoria del sensor (si no, se guardaría pero nunca se encontraría)
  if (id >= (int)finger.capacity) {
    falloRegistro("ID " + String(id) + " no cabe", "Max: " + String(finger.capacity - 1));
    esperarSinDedo(5000);
    return false;
  }
  if (finger.image2Tz(1) != FINGERPRINT_OK) { falloRegistro("Error de lectura", "Intente de nuevo"); return false; }

  // ¿Este dedo ya estaba guardado en otro ID del sensor?
  if (finger.fingerSearch(1) == FINGERPRINT_OK && finger.fingerID != id) {
    int otroId = finger.fingerID;
    String r;
    int codigo = pedir("GET", "/huella-estado?id=" + String(otroId), "", r);
    if (codigo == 200 && r.indexOf("\"asignada\":false") >= 0) {
      // Huella vieja que no es de nadie (pruebas): se borra y el registro continúa
      finger.deleteModel(otroId);
      Serial.printf("[HUELLA] Borrada huella huerfana ID %d\n", otroId);
      mostrar("Huella vieja", "borrada ID " + String(otroId));
      delay(1000);
    } else {
      String dueno = campoJson(r, "nombre_lcd");
      falloRegistro("Dedo ya es de:", dueno != "" ? dueno : "ID " + String(otroId));
      esperarSinDedo(5000);
      return false;
    }
  }

  if (LECTURAS_HUELLA >= 2) {
    beepCorto();
    mostrar("Retire el dedo", "");
    if (!esperarSinDedo(10000)) { falloRegistro("Tiempo agotado", "Intente de nuevo"); return false; }
    mostrar("Ponga el mismo", "indice otra vez");
    if (!esperarDedo(15000)) { falloRegistro("Tiempo agotado", "Intente de nuevo"); return false; }
    if (finger.image2Tz(2) != FINGERPRINT_OK) { falloRegistro("Error lectura 2", "Intente de nuevo"); return false; }
    if (finger.createModel() != FINGERPRINT_OK) {
      mostrar("NO COINCIDEN!", "Intente de nuevo");
      beepDenegado();
      delay(1800);
      reiniciarLcd();
      return false;
    }
  }
  // Guarda la huella del búfer 1 del sensor en la posición "id"
  if (finger.storeModel(id) != FINGERPRINT_OK) { falloRegistro("Error guardando", "en el sensor"); return false; }

  mostrar("EXITO GUARDADO", "ID ASIGNADO: " + String(id));
  beepOK();
  String r;
  pedir("GET", "/registro-exitoso", "", r);   // el servidor vincula la huella y vuelve a modo asistencia
  volverAsistencia();
  delay(1500);
  esperarSinDedo(4000);
  reiniciarLcd();
  return true;
}

// ======================= RFID =======================
// Devuelve el UID en hexadecimal ("A1B2C3D4") o "" si no hay tarjeta nueva
String leerTarjeta() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return "";
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // La misma tarjeta pegada al lector no cuenta dos veces seguidas
  if (uid == ultimaTarjeta && millis() - ultimaTarjetaMs < 2500) return "";
  ultimaTarjeta = uid;
  ultimaTarjetaMs = millis();
  return uid;
}

// El RC522 a veces se "duerme" por ruido eléctrico: si no responde, se reinicia
void revisarLectorRfid() {
  byte v = rfid.PCD_ReadRegister(rfid.VersionReg);
  if (v == 0x00 || v == 0xFF) {
    Serial.println("[RFID] Sin respuesta, reiniciando lector");
    rfid.PCD_Init();
    rfid.PCD_SetAntennaGain(MFRC522::RxGain_max);
  }
}

// Modo "tarjeta": asigna la tarjeta a la persona elegida en el panel
void asignarTarjeta(const String &uid) {
  mostrar("Tarjeta leida", "Enviando...");
  String r;
  int codigo = pedir("POST", "/tarjeta-leida", "{\"uid\":\"" + uid + "\"}", r);
  if (codigo == 200) {
    mostrar("TARJETA LEIDA", "Asignada OK");
    beepOK();
    volverAsistencia();
  } else if (codigo == 409) {
    mostrar("Tarjeta ocupada", "Pase otra");
    beepDenegado();
  } else {
    mostrar("Error de envio", "Codigo " + String(codigo));
    beepError();
  }
  delay(1500);
}

// ======================= ASISTENCIA =======================
// La foto se sube en segundo plano: el equipo queda libre para la siguiente persona
void encolarFoto(Foto &foto, int idAsistencia, bool salida) {
  if (!foto.datos) return;
  foto.idAsistencia = idAsistencia;
  foto.salida = salida;
  if (xQueueSend(colaFotos, &foto, 0) != pdTRUE) {
    Serial.println("[CAM] Cola de fotos llena, se descarta");
    free(foto.datos);
  }
  foto.datos = nullptr;
}

void marcarAsistencia(const String &tipo, const String &identificador) {
  mostrar(tipo == "huella" ? "Huella leida" : "Tarjeta leida", "Verificando...");
  Foto foto = tomarFoto(tipo, identificador);       // la foto es del instante exacto

  // ¿Es la confirmación de una salida que el equipo pidió hace un momento?
  bool confirmando = (identificador == confirmarId) && (long)(confirmarHasta - millis()) > 0;
  confirmarId = "";

  String r;
  int codigo = pedir("POST", "/asistencias",
                     "{\"tipo\":\"" + tipo + "\",\"identificador\":\"" + identificador + "\"" +
                     (confirmando ? ",\"confirmar\":true" : "") + "}", r);
  Serial.printf("[API] %s %s -> %d %s\n", tipo.c_str(), identificador.c_str(), codigo, r.c_str());

  if (codigo >= 200 && codigo < 300) {
    String accion = campoJson(r, "accion");
    String nombre = campoJson(r, "nombre_lcd");
    int idAsistencia = campoNumero(r, "id_asistencia");

    if (accion == "salida") {
      encolarFoto(foto, idAsistencia, true);
      mostrar("Hasta luego", nombre);
      beepOK();
      delay(1200);
      mostrar("Salida " + horaActual(), "Registrada");
      delay(800);
    } else if (accion == "confirmar_salida") {
      // Pasó dos veces seguidas: no se registra nada hasta que confirme
      confirmarId = identificador;
      confirmarHasta = millis() + VENTANA_CONFIRMAR_MS;
      mostrar("Ya registrado", "Pase otra vez");
      beepCorto();
      delay(1100);
      mostrar("si desea salir", nombre);
      delay(1100);
    } else if (accion == "ya_salio") {
      mostrar("Ya registro", "su salida hoy");
      beepCorto();
      delay(1500);
    } else {                                         // "entrada" (o servidor viejo sin "accion")
      encolarFoto(foto, idAsistencia, false);
      String estado = campoJson(r, "estado");
      mostrar("Bienvenido(a)", nombre);
      beepOK();
      delay(1200);
      mostrar("Llegada " + horaActual(), estado == "retardo" ? "Con retardo" : "A tiempo");
      delay(800);
    }
    if (foto.datos) free(foto.datos);                // no se usó (confirmación o ya salió)
    return;
  }

  if (foto.datos) free(foto.datos);                  // no se aceptó: la foto se descarta
  if (codigo == 403) {
    mostrar("ACCESO DENEGADO", tipo == "huella" ? "No registrado" : "Tarjeta invalida");
    beepDenegado();
    // Huella guardada en el sensor que ya no es de nadie: se borra para que no estorbe
    if (tipo == "huella" && r.indexOf("\"huerfana\":true") >= 0) {
      finger.deleteModel(identificador.toInt());
      Serial.println("[HUELLA] Borrada huella huerfana ID " + identificador);
    }
  } else {
    // El código ayuda a saber qué pasó: -100 sin WiFi, -200 la red no respondió, 500 error del servidor
    mostrar("Sin conexion", "Codigo " + String(codigo));
    beepError();
  }
  delay(1200);
}

// ======================= SETUP =======================
void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  beepArranque();

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);
  Wire.setTimeOut(100);
  lcd.init();
  lcd.backlight();

  // Cámara primero (antes del WiFi)
  mostrar("Iniciando...", "Camara");
  camaraOK = iniciarCamara();

  // WiFi
  mostrar("Conectando WiFi", WIFI_NOMBRE);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);                 // sin ahorro de energía: responde más rápido
  WiFi.begin(WIFI_NOMBRE, WIFI_CLAVE);
  WiFi.setTxPower(WIFI_POWER_15dBm);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 20000) { delay(300); Serial.print("."); }
  Serial.println();

  reiniciarLcd();
  if (WiFi.status() == WL_CONNECTED) {
    mostrar("WiFi conectado", WiFi.localIP().toString());
    Serial.printf("WiFi OK, IP del equipo: %s  Senal: %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    Serial.println("Servidor: " + SERVIDOR);
  } else {
    mostrar("WiFi FALLO", "Revise la red");
    beepError();
  }
  delay(1500);

  server.on("/", paginaCamara);
  server.on("/foto", fotoEnVivo);
  server.begin();

  // Reloj: hora por internet y se guarda en el DS3231
  rtc.begin();
  if (WiFi.status() == WL_CONNECTED) {
    mostrar("Ajustando hora", "");
    configTime(-18000, 0, "time.google.com", "pool.ntp.org");   // Colombia UTC-5
    struct tm ti;
    if (getLocalTime(&ti, 6000)) {
      rtc.adjust(DateTime(ti.tm_year + 1900, ti.tm_mon + 1, ti.tm_mday, ti.tm_hour, ti.tm_min, ti.tm_sec));
    }
  }

  // Sensores
  fSerial.begin(57600, SERIAL_8N1, SENSOR_RX_PIN, SENSOR_TX_PIN);
  finger.begin(57600);
  delay(200);
  huellaOK = finger.verifyPassword();
  // IMPORTANTE: la librería asume que el sensor tiene 64 posiciones hasta que se le pregunta.
  // Sin esto, solo busca huellas en los IDs 0..63 y las guardadas más arriba salen como "inválidas".
  if (huellaOK && finger.getParameters() == FINGERPRINT_OK) {
    finger.getTemplateCount();
    Serial.printf("[HUELLA] Capacidad del sensor: %u huellas. Guardadas: %u\n", finger.capacity, finger.templateCount);
  } else if (huellaOK) {
    Serial.println("[HUELLA] No se pudo leer la capacidad del sensor; se usan 64 posiciones");
  }
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN);
  rfid.PCD_Init();
  rfid.PCD_SetAntennaGain(MFRC522::RxGain_max);   // máxima ganancia: lee la tarjeta más fácil
  byte version = rfid.PCD_ReadRegister(rfid.VersionReg);
  bool rfidOK = version != 0x00 && version != 0xFF;

  reiniciarLcd();
  mostrar(String("Cam:") + (camaraOK ? "OK " : "NO ") + "Huella:" + (huellaOK ? "OK" : "NO"),
          String("RFID:") + (rfidOK ? "OK" : "NO"));
  Serial.printf("Camara:%d Huella:%d RFID:%d (version 0x%02X)\n", camaraOK, huellaOK, rfidOK, version);
  if (!camaraOK || !huellaOK || !rfidOK) beepError();

  // Tareas de red en el núcleo 0 (el loop corre en el núcleo 1)
  colaPeticion  = xQueueCreate(1, sizeof(Peticion));
  colaRespuesta = xQueueCreate(1, sizeof(Respuesta));
  colaFotos     = xQueueCreate(4, sizeof(Foto));
  xTaskCreatePinnedToCore(tareaRed,   "red",   8192, nullptr, 1, nullptr, 0);
  xTaskCreatePinnedToCore(tareaFotos, "fotos", 8192, nullptr, 1, nullptr, 0);

  delay(1500);
  reiniciarLcd();
}

// ======================= LOOP (pantalla y sensores) =======================
void loop() {
  server.handleClient();

  // Reconexión WiFi
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long ultimoReintento = 0;
    if (millis() - ultimoReintento > 15000) {
      ultimoReintento = millis();
      WiFi.disconnect();
      WiFi.begin(WIFI_NOMBRE, WIFI_CLAVE);
    }
  }

  if (reinicioPedido) {
    Serial.println("[EQUIPO] Reinicio pedido desde el panel");
    reiniciarLcd();
    mostrar("Reiniciando...", "Orden del panel");
    beepCorto();
    delay(1200);
    ESP.restart();
  }

  if (cambioModo) {
    cambioModo = false;
    reiniciarLcd();                       // pantalla limpia al cambiar de modo
    if (modoActual != MODO_ASISTENCIA) beepCorto();
  }

  // Sensores 10 veces por segundo
  if (millis() - ultimoSensor < 100) return;
  ultimoSensor = millis();

  int modo = modoActual;

  // Cada 20 s, en cualquier modo: limpia la pantalla (el ruido de la fuente o del WiFi
  // a veces deja letras raras) y revisa que el lector de tarjetas siga respondiendo
  if (millis() - ultimoRefrescoLcd > 20000) {
    reiniciarLcd();
    revisarLectorRfid();
  }

  // ---- MODO REGISTRO DE HUELLA ----
  if (modo == MODO_REGISTRO) {
    int id = idHuellaRegistrar;
    mostrar("REGISTRO ID:" + String(id), "Indice derecho");
    if (id > 0) registrarHuella(id);
    return;
  }

  // ---- MODO ASIGNAR TARJETA ----
  if (modo == MODO_TARJETA) {
    mostrar("MODO: TARJETA", "Acerque tarjeta");
    String uid = leerTarjeta();
    if (uid != "") { asignarTarjeta(uid); reiniciarLcd(); }
    return;
  }

  // ---- MODO ASISTENCIA ----
  mostrar(horaActual() + " ASISTENCIA", servidorOK ? "Pase ID o Dedo.." : "Sin servidor...");

  int id = leerHuella();
  if (id > 0) {
    marcarAsistencia("huella", String(id));
    esperarSinDedo(2500);
    reiniciarLcd();                       // después de la foto y el envío, pantalla limpia
    return;
  }
  if (id == -1) {
    mostrar("HUELLA INVALIDA", "No registrada");
    beepDenegado();
    delay(1200);
    esperarSinDedo(2500);
    reiniciarLcd();                       // el pitido y el sensor a veces dejan letras raras
    return;
  }

  String uid = leerTarjeta();
  if (uid != "") { marcarAsistencia("rfid", uid); reiniciarLcd(); }
}
