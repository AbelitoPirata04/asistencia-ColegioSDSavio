-- =====================================================================
--  Base de datos del sistema de asistencia · Colegio Santo Domingo Savio
--  Crea TODAS las tablas desde cero (ya incluye las migraciones 01 a 05)
--  y los datos de catálogo: jornadas, niveles, grados y asignaturas.
--  No incluye datos personales.
--
--  Uso: en phpMyAdmin cree la base "bd_asistencia_savio" e importe este archivo.
-- =====================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `asignaturas` (
  `id_asignatura` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(80) NOT NULL,
  PRIMARY KEY (`id_asignatura`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `credenciales_biometricas` (
  `id_credencial` int(11) NOT NULL AUTO_INCREMENT,
  `id_personal` int(11) NOT NULL,
  `id_huella_sensor` int(11) DEFAULT NULL,
  `codigo_tarjeta_rfid` varchar(50) DEFAULT NULL,
  `tarjeta_activa` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id_credencial`),
  UNIQUE KEY `id_personal` (`id_personal`),
  UNIQUE KEY `id_huella_sensor` (`id_huella_sensor`),
  UNIQUE KEY `codigo_tarjeta_rfid` (`codigo_tarjeta_rfid`),
  CONSTRAINT `credenciales_biometricas_ibfk_1` FOREIGN KEY (`id_personal`) REFERENCES `personal` (`id_personal`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `dias_sin_clase` (
  `id_dia` int(11) NOT NULL AUTO_INCREMENT,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `tipo` enum('festivo','vacaciones','jornada','otro') NOT NULL DEFAULT 'festivo',
  `motivo` varchar(150) NOT NULL,
  PRIMARY KEY (`id_dia`),
  KEY `fechas` (`fecha_inicio`,`fecha_fin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `estado_dispositivo` (
  `id_dispositivo` int(11) NOT NULL,
  `modo_actual` enum('asistencia','registro','tarjeta') DEFAULT 'asistencia',
  `id_personal_enrolando` int(11) DEFAULT NULL,
  `id_huella_asignar` int(11) DEFAULT NULL,
  `modo_desde` datetime DEFAULT NULL,
  `resultado_enrolamiento` varchar(160) DEFAULT NULL,
  `resultado_ok` tinyint(1) DEFAULT NULL,
  `ultima_conexion` datetime DEFAULT NULL,
  PRIMARY KEY (`id_dispositivo`),
  KEY `id_personal_enrolando` (`id_personal_enrolando`),
  CONSTRAINT `estado_dispositivo_ibfk_1` FOREIGN KEY (`id_personal_enrolando`) REFERENCES `personal` (`id_personal`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `grados` (
  `id_grado` int(11) NOT NULL AUTO_INCREMENT,
  `id_nivel` int(11) NOT NULL,
  `nombre` varchar(40) NOT NULL,
  `orden` int(11) NOT NULL,
  PRIMARY KEY (`id_grado`),
  UNIQUE KEY `nivel_nombre` (`id_nivel`,`nombre`),
  CONSTRAINT `grados_nivel_fk` FOREIGN KEY (`id_nivel`) REFERENCES `niveles` (`id_nivel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `horarios` (
  `id_horario` int(11) NOT NULL AUTO_INCREMENT,
  `nombre_jornada` varchar(100) NOT NULL,
  `hora_entrada` time NOT NULL,
  `hora_salida` time NOT NULL,
  `minutos_tolerancia` int(11) DEFAULT 10,
  PRIMARY KEY (`id_horario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `niveles` (
  `id_nivel` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(40) NOT NULL,
  `orden` int(11) NOT NULL,
  `por_asignatura` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id_nivel`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `novedades` (
  `id_novedad` int(11) NOT NULL AUTO_INCREMENT,
  `id_personal` int(11) NOT NULL,
  `tipo` enum('incapacidad','permiso','calamidad','licencia','comision','otro') NOT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `observacion` varchar(255) DEFAULT NULL,
  `fecha_creacion` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id_novedad`),
  KEY `persona_fechas` (`id_personal`,`fecha_inicio`,`fecha_fin`),
  CONSTRAINT `novedades_personal_fk` FOREIGN KEY (`id_personal`) REFERENCES `personal` (`id_personal`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `personal` (
  `id_personal` int(11) NOT NULL AUTO_INCREMENT,
  `cedula` varchar(30) NOT NULL,
  `nombre_completo` varchar(150) NOT NULL,
  `correo` varchar(120) NOT NULL,
  `telefono` varchar(20) DEFAULT NULL,
  `direccion` varchar(150) DEFAULT NULL,
  `foto_perfil` varchar(255) DEFAULT NULL,
  `contrasena` varchar(255) NOT NULL,
  `rol` enum('administrador','directivo','docente') NOT NULL DEFAULT 'docente',
  `cargo_asignatura` varchar(100) DEFAULT NULL,
  `id_nivel` int(11) DEFAULT NULL,
  `id_grado` int(11) DEFAULT NULL,
  `id_asignatura` int(11) DEFAULT NULL,
  `id_horario` int(11) DEFAULT NULL,
  `activo` tinyint(1) DEFAULT 1,
  `fecha_creacion` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id_personal`),
  UNIQUE KEY `cedula` (`cedula`),
  UNIQUE KEY `correo` (`correo`),
  KEY `id_horario` (`id_horario`),
  KEY `personal_nivel_fk` (`id_nivel`),
  KEY `personal_grado_fk` (`id_grado`),
  KEY `personal_asignatura_fk` (`id_asignatura`),
  CONSTRAINT `personal_asignatura_fk` FOREIGN KEY (`id_asignatura`) REFERENCES `asignaturas` (`id_asignatura`) ON DELETE SET NULL,
  CONSTRAINT `personal_grado_fk` FOREIGN KEY (`id_grado`) REFERENCES `grados` (`id_grado`) ON DELETE SET NULL,
  CONSTRAINT `personal_ibfk_1` FOREIGN KEY (`id_horario`) REFERENCES `horarios` (`id_horario`) ON DELETE SET NULL,
  CONSTRAINT `personal_nivel_fk` FOREIGN KEY (`id_nivel`) REFERENCES `niveles` (`id_nivel`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `registros_asistencia` (
  `id_asistencia` int(11) NOT NULL AUTO_INCREMENT,
  `id_personal` int(11) NOT NULL,
  `fecha_hora_entrada` datetime NOT NULL,
  `fecha_hora_salida` datetime DEFAULT NULL,
  `metodo_ingreso` enum('huella','rfid','manual') NOT NULL,
  `metodo_salida` enum('huella','rfid','manual') DEFAULT NULL,
  `estado_puntualidad` enum('puntual','retardo') NOT NULL,
  `observacion` varchar(255) DEFAULT NULL,
  `ruta_fotografia` varchar(255) DEFAULT NULL,
  `ruta_foto_salida` varchar(255) DEFAULT NULL,
  `sincronizado_sd` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id_asistencia`),
  KEY `persona_fecha` (`id_personal`,`fecha_hora_entrada`),
  CONSTRAINT `registros_asistencia_ibfk_1` FOREIGN KEY (`id_personal`) REFERENCES `personal` (`id_personal`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


-- ===== Datos de catálogo =====

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

LOCK TABLES `horarios` WRITE;
/*!40000 ALTER TABLE `horarios` DISABLE KEYS */;
INSERT INTO `horarios` VALUES (1,'Jornada Mañana','06:45:00','13:00:00',10);
INSERT INTO `horarios` VALUES (2,'Jornada Tarde','13:00:00','18:30:00',10);
/*!40000 ALTER TABLE `horarios` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `niveles` WRITE;
/*!40000 ALTER TABLE `niveles` DISABLE KEYS */;
INSERT INTO `niveles` VALUES (1,'Preescolar',1,0);
INSERT INTO `niveles` VALUES (2,'Primaria',2,0);
INSERT INTO `niveles` VALUES (3,'Bachillerato',3,1);
/*!40000 ALTER TABLE `niveles` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `grados` WRITE;
/*!40000 ALTER TABLE `grados` DISABLE KEYS */;
INSERT INTO `grados` VALUES (1,1,'Párvulo',1);
INSERT INTO `grados` VALUES (2,1,'Prejardín',2);
INSERT INTO `grados` VALUES (3,1,'Jardín',3);
INSERT INTO `grados` VALUES (4,1,'Transición',4);
INSERT INTO `grados` VALUES (5,2,'Grado Primero',5);
INSERT INTO `grados` VALUES (6,2,'Grado Segundo',6);
INSERT INTO `grados` VALUES (7,2,'Grado Tercero',7);
INSERT INTO `grados` VALUES (8,2,'Grado Cuarto',8);
INSERT INTO `grados` VALUES (9,2,'Grado Quinto',9);
/*!40000 ALTER TABLE `grados` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `asignaturas` WRITE;
/*!40000 ALTER TABLE `asignaturas` DISABLE KEYS */;
INSERT INTO `asignaturas` VALUES (1,'Ciencias Naturales');
INSERT INTO `asignaturas` VALUES (5,'Ciencias Sociales');
INSERT INTO `asignaturas` VALUES (7,'Ética');
INSERT INTO `asignaturas` VALUES (4,'Inglés');
INSERT INTO `asignaturas` VALUES (3,'Lengua Castellana');
INSERT INTO `asignaturas` VALUES (2,'Matemáticas');
INSERT INTO `asignaturas` VALUES (6,'Religión');
/*!40000 ALTER TABLE `asignaturas` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


-- Notificaciones push al teléfono del encargado
CREATE TABLE IF NOT EXISTS suscripciones_push (
  id_suscripcion INT AUTO_INCREMENT PRIMARY KEY,
  id_personal INT NOT NULL,
  huella_endpoint CHAR(64) NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  dispositivo VARCHAR(160) NULL,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT suscripciones_personal_fk FOREIGN KEY (id_personal) REFERENCES personal (id_personal) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estado inicial del equipo (un solo ESP32)
INSERT INTO estado_dispositivo (id_dispositivo, modo_actual) VALUES (1, 'asistencia');

SET FOREIGN_KEY_CHECKS = 1;