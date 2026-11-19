# Sube el código al servidor de DigitalOcean y reinicia el sistema.
#
# Uso (en la terminal de VS Code):   npm run desplegar
#
# Antes: guarde sus cambios con un commit (panel Source Control > Commit).
# Solo se sube lo que está en el último commit. No toca la base de datos,
# ni las fotos (uploads/), ni las claves del servidor (.env).

$ErrorActionPreference = 'Stop'
$servidor = 'root@143.110.198.171'
$llave = Join-Path $HOME '.ssh\savio_do'
$panel = 'https://savio.143-110-198-171.sslip.io'
Set-Location (Join-Path $PSScriptRoot '..')

function Write-Paso($texto) { Write-Host "`n$texto" -ForegroundColor Cyan }
function Stop-Error($texto) { Write-Host "`n$texto" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $llave)) { Stop-Error "No encuentro la llave del servidor en $llave" }

# 1. Todo debe estar en un commit
$pendientes = git status --porcelain
if ($pendientes) {
  Write-Host "`nHay cambios sin commit:" -ForegroundColor Yellow
  $pendientes | ForEach-Object { Write-Host "  $_" }
  Stop-Error 'Haga commit primero (Source Control > Commit) y vuelva a ejecutar npm run desplegar.'
}

# 2. Copia en GitHub
Write-Paso '1/3 Subiendo a GitHub...'
git push origin main
if ($LASTEXITCODE -ne 0) { Stop-Error 'No se pudo subir a GitHub. Revise su conexion a internet.' }

# 3. Empaquetar el commit y copiarlo al servidor
Write-Paso '2/3 Copiando el codigo al servidor...'
$archivo = Join-Path $env:TEMP 'savio_codigo.tar.gz'
git archive --format=tar.gz -o $archivo HEAD
scp -i $llave -o StrictHostKeyChecking=accept-new $archivo "${servidor}:/root/codigo.tar.gz"
if ($LASTEXITCODE -ne 0) { Stop-Error 'No se pudo copiar al servidor.' }

# 4. En el servidor: descomprimir sin tocar fotos ni .env, instalar librerías si cambiaron, reiniciar
Write-Paso '3/3 Actualizando y reiniciando el sistema...'
$ordenes = @(
  'set -e',
  'cd /opt/savio',
  'antes=$(sha1sum package-lock.json | cut -c1-40)',
  'tar --exclude=uploads --exclude=.env -xzf /root/codigo.tar.gz -C /opt/savio',
  'despues=$(sha1sum package-lock.json | cut -c1-40)',
  'if [ $antes != $despues ]; then echo Instalando librerias nuevas...; npm ci --omit=dev --no-audit --no-fund; fi',
  'chown -R savio:savio /opt/savio',
  'systemctl restart savio',
  'sleep 3',
  'systemctl is-active savio'
) -join '; '
$estado = ssh -i $llave $servidor $ordenes
$estado | ForEach-Object { Write-Host "  $_" }

if ($estado -and ($estado | Select-Object -Last 1) -eq 'active') {
  Write-Host "`nListo. El sistema ya tiene los cambios: $panel" -ForegroundColor Green
  Write-Host 'Si tenia el panel abierto, recargue con Ctrl+F5.'
} else {
  Stop-Error 'El sistema no arranco despues del cambio. Revise el error con: ssh -i ~/.ssh/savio_do root@143.110.198.171 journalctl -u savio -n 30'
}
