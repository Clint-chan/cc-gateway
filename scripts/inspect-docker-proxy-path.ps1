param(
  [string]$ProxyHost = "host.docker.internal",
  [int]$ProxyPort = 10808,
  [string]$ProbeImage = "php:7.4-apache"
)

$ErrorActionPreference = "Stop"

function Get-DockerProxySettings {
  $settingsPath = Join-Path $env:APPDATA "Docker\settings-store.json"
  if (-not (Test-Path $settingsPath)) {
    return $null
  }

  try {
    return Get-Content $settingsPath -Raw | ConvertFrom-Json
  }
  catch {
    return $null
  }
}

function Test-ProbeImagePresent {
  param([string]$Image)

  docker image inspect $Image *> $null
  return $LASTEXITCODE -eq 0
}

function Invoke-ContainerProbe {
  param(
    [string]$Image,
    [string]$HostName,
    [int]$Port
  )

  $tempPath = Join-Path $env:TEMP "docker-proxy-probe-$PID.php"
  $template = @'
<?php
$fp = @fsockopen('__HOST__', __PORT__, $errno, $errstr, 5);
if ($fp) {
  echo "ok\n";
  fclose($fp);
} else {
  echo "fail $errno $errstr\n";
}
'@
  $template = $template.Replace("__HOST__", $HostName).Replace("__PORT__", [string]$Port)
  $template | Set-Content -Encoding ascii $tempPath
  try {
    $output = docker run --rm --add-host "${HostName}:host-gateway" -v "${tempPath}:/tmp/probe.php:ro" $Image php /tmp/probe.php 2>&1
    if ($LASTEXITCODE -ne 0) {
      return "docker-run-failed: $($output | Out-String).Trim()"
    }
    return ($output | Out-String).Trim()
  }
  finally {
    if (Test-Path $tempPath) {
      Remove-Item $tempPath -Force
    }
  }
}

$listeners = @(
  Get-NetTCPConnection -LocalPort $ProxyPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess
)

$dockerSettings = Get-DockerProxySettings
$probeImagePresent = Test-ProbeImagePresent -Image $ProbeImage
$containerProbe = $null

if ($probeImagePresent) {
  $containerProbe = Invoke-ContainerProbe -Image $ProbeImage -HostName $ProxyHost -Port $ProxyPort
}

[pscustomobject]@{
  proxy_host = $ProxyHost
  proxy_port = $ProxyPort
  host_listeners = $listeners
  docker_proxy_mode = $dockerSettings.ProxyHTTPMode
  docker_proxy_http = $dockerSettings.OverrideProxyHTTP
  docker_proxy_https = $dockerSettings.OverrideProxyHTTPS
  probe_image = $ProbeImage
  probe_image_present = $probeImagePresent
  container_probe = $containerProbe
} | ConvertTo-Json -Depth 6
