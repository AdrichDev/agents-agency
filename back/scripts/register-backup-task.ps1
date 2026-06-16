# register-backup-task.ps1
# Registra una tarea programada de Windows que ejecuta el backup de la BD a diario.
# Ejecutar UNA vez (PowerShell): powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1
#
# Para borrarla:  schtasks /Delete /TN "AgentsAgency-DB-Backup" /F
# Para probarla:  schtasks /Run /TN "AgentsAgency-DB-Backup"

$ErrorActionPreference = "Stop"

$TaskName = "AgentsAgency-DB-Backup"
$NodeExe  = "C:\Program Files\nodejs\node.exe"
$ScriptPath = Join-Path $PSScriptRoot "backup-db.mjs"
$RunTime  = "03:00"   # 3 AM diario

# Acción: node backup-db.mjs (el script resuelve rutas por __dirname, cwd irrelevante)
$Action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$ScriptPath`""

# Disparador: diario a las 03:00
$Trigger = New-ScheduledTaskTrigger -Daily -At $RunTime

# Si el equipo estaba apagado a las 03:00, ejecuta al encender
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force -Description "Backup diario de la BD agents-agency (pg_dump via Docker)"

Write-Host ("register: Tarea '" + $TaskName + "' registrada - backup diario a las " + $RunTime + ".")
Write-Host ("register: Probar ahora con -> schtasks /Run /TN " + $TaskName)
