# Waits until something listens on a local port. Exit code 1 if the timeout passes first.
param([int]$Port, [int]$TimeoutSeconds = 60)
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { exit 0 }
  Start-Sleep -Milliseconds 300
}
exit 1
