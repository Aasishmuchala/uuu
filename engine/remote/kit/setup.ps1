# Company Engine: sets this PC up for the Mac that made this stick. "Set up.cmd" runs it with
# -NoProfile -ExecutionPolicy Bypass -File. Windows PowerShell 5.1 built-ins only: no module, no download,
# no administrator rights. The PC's private key is made in %LOCALAPPDATA%\CompanyEngine and never leaves it;
# only its public line goes on the stick, as seat-request.txt.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

# Every sentence this script shows.
$Say = @{
  TooOld = "This PC's Windows is too old for Company Engine."
  NoSsh  = 'Turn on "OpenSSH Client" in Windows Settings, Optional features, then run this again.'
  BadKit = 'This stick does not hold a whole kit. Make it again on the Mac.'
  Failed = 'Set up could not finish: {0}'
  Code   = "This PC's code: {0}"
  Back   = 'Take this stick back to the Mac. The PC cannot connect until the Mac allows it.'
}

$Kit    = Split-Path -Parent $PSScriptRoot
$Here   = Join-Path $env:LOCALAPPDATA 'CompanyEngine'
$Keygen = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh-keygen.exe'
$Ssh    = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$Copied = @('open.ps1', 'ssh-args.txt', 'door.txt', 'known_hosts', 'CompanyEngine.ico')

function Stop-Setup([string]$Text) {
  Write-Host $Text
  exit 1
}

# Windows 10 version 1809 (build 17763) or later.
function Assert-Windows {
  if ([Environment]::OSVersion.Version.Build -lt 17763) { Stop-Setup $Say.TooOld }
}

# Windows' own OpenSSH client, by its full path.
function Assert-Ssh {
  foreach ($exe in @($Ssh, $Keygen)) {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Stop-Setup $Say.NoSsh }
  }
}

# The seat number, from the first line of door.txt; every file the PC needs must be on the stick.
function Get-Seat {
  foreach ($name in $Copied) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) { Stop-Setup $Say.BadKit }
  }
  $first = @(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'door.txt') -TotalCount 1)
  if ($first.Count -eq 1 -and $first[0] -cmatch '^seat ([1-5])$') { return [int]$Matches[1] }
  Stop-Setup $Say.BadKit
}

# The PC's folder, with the kit's files and the empty file ssh.exe is given as its settings.
function Copy-KitFiles {
  [void][IO.Directory]::CreateDirectory($Here)
  foreach ($name in $Copied) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $Here $name) -Force
  }
  [IO.File]::WriteAllText((Join-Path $Here 'empty'), '')
}

# The PC's own key: made once, never overwritten. Returns the key's path.
function New-SeatKey([int]$Seat) {
  $key = Join-Path $Here 'seat_key'
  if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
    # Windows PowerShell 5.1 drops an empty argument; '""' reaches ssh-keygen as an empty passphrase.
    & $Keygen -q -t ed25519 -N '""' -C "seat-$Seat" -f $key | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen could not make the key' }
  }
  return $key
}

# The key's public half (the base64 part only), read back from the private key itself.
function Get-PublicKey([string]$Key) {
  $line = [string](& $Keygen -y -f $Key)
  if ($LASTEXITCODE -ne 0 -or $line -cnotmatch '^ssh-ed25519 ([A-Za-z0-9+/]{68})( |$)') { throw 'the key could not be read' }
  return $Matches[1]
}

# The code the owner compares on the Mac: SHA256 of the key, as ssh-keygen -l shows it.
function Get-Fingerprint([string]$Public) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash([Convert]::FromBase64String($Public))
  return 'SHA256:' + [Convert]::ToBase64String($hash).TrimEnd('=')
}

# seat-request.txt beside "Set up.cmd": one line, the public key and the seat it was made for.
function Write-Request([string]$Public, [int]$Seat) {
  $line = "ssh-ed25519 $Public seat-$Seat`n"
  [IO.File]::WriteAllText((Join-Path $Kit 'seat-request.txt'), $line, [Text.Encoding]::ASCII)
}

# "Company Engine" on the Desktop and in the Start menu: open.ps1, hidden, with the loft icon.
function New-Shortcuts {
  $shell = New-Object -ComObject WScript.Shell
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $open = Join-Path $Here 'open.ps1'
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    $link = $shell.CreateShortcut((Join-Path $folder 'Company Engine.lnk'))
    $link.TargetPath = $powershell
    $link.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $open + '"'
    $link.IconLocation = (Join-Path $Here 'CompanyEngine.ico') + ',0'
    $link.WorkingDirectory = $Here
    $link.WindowStyle = 7
    $link.Save()
  }
}

Assert-Windows
Assert-Ssh
$seat = Get-Seat
try {
  Copy-KitFiles
  $public = Get-PublicKey (New-SeatKey $seat)
  Write-Request $public $seat
  New-Shortcuts
} catch {
  Stop-Setup ($Say.Failed -f $_.Exception.Message)
}
Write-Host ($Say.Code -f (Get-Fingerprint $public))
Write-Host $Say.Back
