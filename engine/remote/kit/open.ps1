# Company Engine: carries this PC's 127.0.0.1:3200 to the Mac through Windows' own ssh.exe, opens one window on it,
# and stops that ssh.exe when the window closes. Run hidden by the shortcut. PowerShell 5.1 built-ins, no admin rights.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

# Every sentence this script shows.
$Say = @{
  Busy   = "Another program on this PC is using the engine's address. Close it and try again."
  Off    = 'The Mac is off, asleep, or not on this network.'
  NotYet = 'This PC is not allowed yet. On the Mac, allow it first.'
  NotMac = 'The computer that answered is not your Mac. Nothing was sent.'
  Broken = 'Company Engine is not set up on this PC. Run "Set up" from the stick again.'
}

$Here = $PSScriptRoot
$Url  = 'http://127.0.0.1:3200'
$Ssh  = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$Data = Join-Path $Here 'edge'
# ssh-args.txt's lines, each whole: every one once, the target last; then only the app ports' forwards.
$Pinned = @('-F {EMPTY}', '-N', '-T', '-i {KEY}', '-o IdentitiesOnly=yes', '-o IdentityAgent=none', '-o BatchMode=yes',
  '-o StrictHostKeyChecking=yes', '-o UserKnownHostsFile={KNOWN}', '-o GlobalKnownHostsFile={EMPTY}', '-o HostKeyAlias=company-engine',
  '-o HostKeyAlgorithms=ssh-ed25519', '-o ForwardAgent=no', '-o ConnectTimeout=8', '-o ServerAliveInterval=15',
  '-o ServerAliveCountMax=3', '-o ExitOnForwardFailure=no', '-L 127.0.0.1:3200:127.0.0.1:{SEATPORT}', '{USER}@{HOST}')

function Show-Message([string]$Text) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($Text, 'Company Engine')
}

function Stop-Open([string]$Text) { Show-Message $Text; exit 1 }

# True when the engine answers on this PC's 127.0.0.1:3200 as a seat (step 1).
function Test-Engine {
  try {
    $shell = Invoke-RestMethod -Uri "$Url/api/shell" -TimeoutSec 2 -UseBasicParsing
    return ($null -ne $shell) -and ($shell.PSObject.Properties.Name -contains 'seat') -and ($null -ne $shell.seat)
  } catch { return $false }
}

# True when something else already listens on this PC's 127.0.0.1:3200 (step 2).
function Test-PortBusy {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect('127.0.0.1', 3200, $null, $null)
    return ($wait.AsyncWaitHandle.WaitOne(1000) -and $client.Connected)
  } catch { return $false } finally { $client.Close() }
}

# door.txt as the Mac wrote it: the seat, the door's port, the Mac's user name, then each host to try in order.
function Read-Door {
  $door = @{ Seat = 0; Port = 0; User = ''; Hosts = @() }
  foreach ($line in @(Get-Content -LiteralPath (Join-Path $Here 'door.txt'))) {
    if ($line -cmatch '^seat ([1-5])$') { $door.Seat = [int]$Matches[1] }
    elseif ($line -cmatch '^port ([0-9]{1,5})$') { $door.Port = [int]$Matches[1] }
    elseif ($line -cmatch '^user ([A-Za-z0-9_][A-Za-z0-9_.-]{0,31})$') { $door.User = $Matches[1] }
    elseif ($line -cmatch '^host ([A-Za-z0-9][A-Za-z0-9.-]{0,252})$') { $door.Hosts += $Matches[1] }
    elseif ($line -ne '') { Stop-Open $Say.Broken }
  }
  if ($door.Seat -eq 0 -or $door.Port -eq 0 -or $door.User -eq '' -or $door.Hosts.Count -eq 0) { Stop-Open $Say.Broken }
  return $door
}

# ssh.exe's arguments, one per line of ssh-args.txt (the Mac's own tests read the same file), filled in and quoted.
function Get-SshArgs($Door, [string]$Target) {
  $fill = @{ '{KEY}' = (Join-Path $Here 'seat_key'); '{KNOWN}' = (Join-Path $Here 'known_hosts'); '{EMPTY}' = (Join-Path $Here 'empty')
    '{SEATPORT}' = [string](3200 + $Door.Seat); '{USER}' = $Door.User; '{HOST}' = $Target }
  $lines = @(Get-Content -LiteralPath (Join-Path $Here 'ssh-args.txt') | Where-Object { $_ -ne '' })
  $must = $Pinned + @("-p $($Door.Port)")
  $may = $must + @((@(3160..3169) + @(3171..3189)) | ForEach-Object { "-L 127.0.0.1:${_}:127.0.0.1:$_" })
  foreach ($line in $lines) { if ($may -cnotcontains $line) { Stop-Open $Say.Broken } }
  foreach ($line in $must) { if (@($lines | Where-Object { $_ -ceq $line }).Count -ne 1) { Stop-Open $Say.Broken } }
  if ($lines[-1] -cne '{USER}@{HOST}') { Stop-Open $Say.Broken }
  $out = @()
  foreach ($line in $lines) {
    foreach ($part in $line.Split([char[]]@(' '), 2)) {
      foreach ($name in $fill.Keys) { $part = $part.Replace($name, $fill[$name]) }
      if ($part.Contains('"')) { Stop-Open $Say.Broken }
      if ($part.Contains(' ')) {
        # ssh splits an -o value at spaces unless it is quoted, and Windows needs those quotes escaped.
        if ($part -cmatch '^([A-Za-z]+)=(.+)$') { $part = $Matches[1] + '="' + $Matches[2] + '"' }
        $part = '"' + $part.Replace('"', '\"') + '"'
      }
      $out += $part
    }
  }
  return ($out -join ' ')
}

# Starts ssh.exe hidden for each host in turn and waits up to 15 seconds for step 1's answer (step 3).
# Returns the ssh.exe process; on failure shows why and ends.
function Start-Tunnel($Door) {
  $err = Join-Path $Here 'ssh-error.txt'
  $out = Join-Path $Here 'ssh-output.txt'
  $why = $Say.Off
  foreach ($target in $Door.Hosts) {
    $proc = Start-Process -FilePath $Ssh -ArgumentList (Get-SshArgs $Door $target) -WindowStyle Hidden -PassThru `
      -RedirectStandardError $err -RedirectStandardOutput $out
    $until = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $until -and -not $proc.HasExited) {
      if (Test-Engine) { return $proc }
      Start-Sleep -Milliseconds 500
    }
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    $text = [string](Get-Content -LiteralPath $err -Raw -ErrorAction SilentlyContinue)
    # Never offered to continue, and known_hosts is never changed.
    if ($text -cmatch 'HOST KEY|Host key verification failed') { Stop-Open $Say.NotMac }
    if ($text -cmatch 'Permission denied') { $why = $Say.NotYet }
  }
  Stop-Open $why
}

# Edge from either Program Files folder, else Chrome the same way; $null when neither is there.
function Find-Browser {
  foreach ($exe in @('Microsoft\Edge\Application\msedge.exe', 'Google\Chrome\Application\chrome.exe')) {
    foreach ($root in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
      if ($root -and (Test-Path -LiteralPath (Join-Path $root $exe) -PathType Leaf)) { return (Join-Path $root $exe) }
    }
  }
  return $null
}

# One window with no address bar, on its own profile with no extensions; returns when it is closed (step 4).
function Open-Window($Tunnel) {
  $browser = Find-Browser
  if (-not $browser) {
    # The default browser cannot be waited for: the tunnel stays until ssh.exe ends by itself.
    Start-Process $Url
    if ($Tunnel) { Wait-Process -Id $Tunnel.Id }
    return
  }
  $flags = "--app=$Url --user-data-dir=`"$Data`" --no-first-run --disable-extensions"
  Start-Process -FilePath $browser -ArgumentList $flags -Wait
  # The browser may hand its window to a process of its own and return early: wait while any runs on this profile.
  while (@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Data) }).Count -gt 0) {
    Start-Sleep -Seconds 2
  }
}

$tunnel = $null
try {
  $door = Read-Door
  if (-not (Test-Engine)) {
    if (Test-PortBusy) { Stop-Open $Say.Busy }
    $tunnel = Start-Tunnel $door
  }
  Open-Window $tunnel
} catch { Show-Message $Say.Broken } finally {
  if ($tunnel) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
}
