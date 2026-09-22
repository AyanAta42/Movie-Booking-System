<#
.SYNOPSIS
  Builds the three images, pushes them to Amazon ECR, and registers the ECS
  task definitions for your account. Run it from the repository root.

.DESCRIPTION
  Images (all from this repo):
    mbp-api  - api/Dockerfile, target "runtime". Runs as browsing OR booking,
               chosen by the SERVICE env var in each task definition.
    mbp-ops  - api/Dockerfile, target "migrate". One-off jobs: migrations by
               default, the seed when its command is overridden.
    mbp-web  - web/Dockerfile. The React site, served by nginx.

  Task definitions are rendered from deploy/aws/task-definitions/*.json into
  deploy/aws/rendered/ (gitignored), with your account id, region and time
  zone filled in, then registered with ECS.

.EXAMPLE
  .\deploy\aws\publish.ps1
  First deploy: build, push, register task definitions.

.EXAMPLE
  .\deploy\aws\publish.ps1 -Deploy
  Every deploy after that: also roll the running services onto the new images.

.EXAMPLE
  .\deploy\aws\publish.ps1 -DryRun
  Build the images and render the task definitions without touching AWS.
#>
param(
  # Where everything lives. Sydney is closest to Australia.
  [string]$Region = "ap-southeast-2",
  # Looked up from your AWS CLI sign-in when omitted.
  [string]$AccountId,
  # The time zone showtimes are scheduled and listed in. Containers default to
  # UTC; the seed and browsing must agree, or shows land on the wrong day.
  [string]$TimeZone = "Australia/Sydney",
  # After registering, point the running ECS services at the new revision.
  [switch]$Deploy,
  # Build and render only. No AWS calls, nothing pushed.
  [switch]$DryRun,
  [string]$Cluster = "mbp"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

# Native commands (docker, aws) do not throw on failure in PowerShell; they set
# $LASTEXITCODE. This turns a non-zero exit into a stop, with a readable name.
function Invoke-Step([string]$What, [scriptblock]$Command) {
  Write-Host ""
  Write-Host "==> $What" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
}

# Runs an aws query and returns its text output, or $null if the command
# failed. Windows PowerShell turns a native command's stderr into terminating
# errors under ErrorActionPreference=Stop, so it is relaxed locally.
function Get-AwsText([scriptblock]$Command) {
  $ErrorActionPreference = "Continue"
  $out = & $Command 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ("$out").Trim()
}

# ---- who and where -----------------------------------------------------------
if ($DryRun) {
  if (-not $AccountId) { $AccountId = "123456789012" }
  Write-Host "Dry run: building and rendering only; account id $AccountId is a placeholder." -ForegroundColor Yellow
} else {
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "The AWS CLI is not installed. See docs/deploy-aws.md, step 3."
  }
  if (-not $AccountId) {
    $AccountId = Get-AwsText { aws sts get-caller-identity --query Account --output text }
    if (-not $AccountId) {
      throw "Not signed in to AWS. Run 'aws sso login' first (docs/deploy-aws.md, step 3)."
    }
  }
}
$registry = "$AccountId.dkr.ecr.$Region.amazonaws.com"
Write-Host "Account $AccountId, region $Region, registry $registry"

$images = @(
  @{ Repo = "mbp-api"; Context = "api"; Target = "runtime" },
  @{ Repo = "mbp-ops"; Context = "api"; Target = "migrate" },
  @{ Repo = "mbp-web"; Context = "web"; Target = "" }
)

# ---- build ---------------------------------------------------------------------
# linux/amd64 to match the task definitions' X86_64 runtime. Building on an
# ARM machine (an M-series Mac) without this produces images Fargate cannot run.
foreach ($img in $images) {
  $tag = "$registry/$($img.Repo):latest"
  $buildArgs = @("build", "--platform", "linux/amd64", "-t", $tag)
  if ($img.Target) { $buildArgs += @("--target", $img.Target) }
  $buildArgs += (Join-Path $root $img.Context)
  Invoke-Step "build $($img.Repo)" { docker @buildArgs }
}

# ---- push ----------------------------------------------------------------------
if (-not $DryRun) {
  foreach ($img in $images) {
    $repo = $img.Repo
    $found = Get-AwsText { aws ecr describe-repositories --repository-names $repo --region $Region --query "repositories[0].repositoryName" --output text }
    if ($found -ne $repo) {
      Invoke-Step "create ECR repository $repo" {
        aws ecr create-repository --repository-name $repo --region $Region --image-scanning-configuration scanOnPush=true --query "repository.repositoryUri" --output text
      }
    }
  }

  Invoke-Step "log in to ECR" {
    # Not a plain pipe. Windows PowerShell 5.1 re-encodes a native command's
    # output on its way to another native command and appends a trailing
    # newline, which docker sends as part of the password; ECR rejects it with
    # a 400. Writing the token to a BOM-free file and redirecting it through
    # cmd hands docker the exact bytes aws produced.
    $token = aws ecr get-login-password --region $Region
    if ($LASTEXITCODE -ne 0) { return }
    $tokenFile = Join-Path ([System.IO.Path]::GetTempPath()) "mbp-ecr-token.txt"
    try {
      [System.IO.File]::WriteAllText($tokenFile, $token, (New-Object System.Text.UTF8Encoding $false))
      cmd /c "docker login --username AWS --password-stdin $registry < `"$tokenFile`""
    } finally {
      Remove-Item $tokenFile -Force -ErrorAction SilentlyContinue
    }
  }

  foreach ($img in $images) {
    $tag = "$registry/$($img.Repo):latest"
    Invoke-Step "push $($img.Repo)" { docker push $tag }
  }

  # Where every container's output goes. Created here because the task
  # execution role is not allowed to create log groups itself.
  $group = Get-AwsText { aws logs describe-log-groups --log-group-name-prefix /ecs/mbp --region $Region --query "logGroups[?logGroupName=='/ecs/mbp'] | [0].logGroupName" --output text }
  if ($group -ne "/ecs/mbp") {
    Invoke-Step "create log group /ecs/mbp" { aws logs create-log-group --log-group-name /ecs/mbp --region $Region }
  }
}

# ---- render task definitions ---------------------------------------------------
$templates = Join-Path $PSScriptRoot "task-definitions"
$rendered = Join-Path $PSScriptRoot "rendered"
New-Item -ItemType Directory -Force -Path $rendered | Out-Null
# UTF-8 without a byte-order mark: the AWS CLI rejects a BOM, and
# Set-Content -Encoding utf8 writes one in Windows PowerShell.
$utf8 = New-Object System.Text.UTF8Encoding $false

Write-Host ""
Write-Host "==> render task definitions into deploy\aws\rendered" -ForegroundColor Cyan
foreach ($file in Get-ChildItem $templates -Filter *.json) {
  $json = [System.IO.File]::ReadAllText($file.FullName)
  $json = $json.Replace("{{ACCOUNT_ID}}", $AccountId).Replace("{{REGION}}", $Region).Replace("{{TZ}}", $TimeZone)
  if ($json -match "\{\{") { throw "$($file.Name) still has an unfilled {{placeholder}}" }
  $null = $json | ConvertFrom-Json  # fails loudly on malformed JSON
  [System.IO.File]::WriteAllText((Join-Path $rendered $file.Name), $json, $utf8)
  Write-Host "   $($file.Name)"
}

if ($DryRun) {
  Write-Host ""
  Write-Host "Dry run complete: images built, task definitions rendered, nothing sent to AWS." -ForegroundColor Green
  return
}

# ---- register task definitions -------------------------------------------------
# Each registration creates a new revision (mbp-booking:1, :2, ...). Old
# revisions stay, which is what makes rolling back a one-click change.
foreach ($file in Get-ChildItem $rendered -Filter *.json) {
  $uri = "file://" + ($file.FullName -replace "\\", "/")
  Invoke-Step "register task definition $($file.BaseName)" {
    aws ecs register-task-definition --cli-input-json $uri --region $Region --query "taskDefinition.taskDefinitionArn" --output text
  }
}

# ---- roll the services -----------------------------------------------------------
if ($Deploy) {
  foreach ($service in @("browsing", "booking", "web")) {
    $active = Get-AwsText { aws ecs describe-services --cluster $Cluster --services $service --region $Region --query "services[?status=='ACTIVE'] | [0].serviceName" --output text }
    if ($active -eq $service) {
      Invoke-Step "deploy $service" {
        aws ecs update-service --cluster $Cluster --service $service --task-definition "mbp-$service" --force-new-deployment --region $Region --query "service.serviceName" --output text
      }
    } else {
      Write-Host "   $service is not an ECS service yet; skipping" -ForegroundColor Yellow
    }
  }
  Write-Host ""
  Write-Host "Deployments started. ECS starts new tasks, waits for each to pass its"
  Write-Host "health check, then drains and stops the old ones."
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
