$ErrorActionPreference = "Stop"
Set-Location -LiteralPath 'C:\Users\Admin\Documents\Pivotr\Marketing Material\TermiSend'
& 'C:\Users\Admin\.bun\bin\bun.exe' 'C:\Users\Admin\Documents\Pivotr\Marketing Material\TermiSend\dist\index.js'
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "TermiSend exited with code $LASTEXITCODE."
}