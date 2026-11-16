# Exit code 1 when the production build is missing or older than the code and settings it was built from.
$root = Join-Path $PSScriptRoot ".."
$buildId = Join-Path $root ".next\BUILD_ID"
if (-not (Test-Path $buildId)) { exit 1 }
$built = (Get-Item $buildId).LastWriteTime
$inputs = @((Join-Path $root "src"), (Join-Path $root "prisma"), (Join-Path $root "public"))
$changed = Get-ChildItem -Path $inputs -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1
$settings = Get-ChildItem -Path $root -File -Include "package.json", "tsconfig.json", "next.config.ts", ".env.local" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1
if ($changed -or $settings) { exit 1 }
exit 0
