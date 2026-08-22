<#
 GA P6 autopsy: "Specified cast is not valid." during UIA invoke.

 For each InvokePattern-advertising candidate in a live target window:
   1. re-resolve the RuntimeId against the CURRENT subtree (fresh element)
   2. GetCurrentPattern(InvokePattern) separately from Invoke()
   3. on Invoke() failure: exact exception type chain + HResult
   4. ONE bounded re-resolve + retry to distinguish transient staleness
      from an app-specific broken pattern advertisement

 Usage:  powershell -NoProfile -File cast-autopsy.ps1 -ProcId <pid> [-Max 12]
 Output: JSON lines, one per candidate.
#>
param(
  [Parameter(Mandatory = $true)][int]$ProcId,
  [int]$Max = 12
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$ProcId)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
if ($wins.Count -eq 0) {
  [Console]::Out.WriteLine('{"fatal":"no top-level window for pid"}')
  exit 1
}
$win = $null
foreach ($w in $wins) { if ($null -eq $win) { $win = $w } }

function Send([object]$o) {
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6))
}

$subtree = $win.FindAll([System.Windows.Automation.TreeScope]::Subtree,
  [System.Windows.Automation.Condition]::TrueCondition)

$tested = 0
foreach ($e in $subtree) {
  if ($tested -ge $Max) { break }
  try {
    $c = $e.Current
    if (-not $c.IsEnabled) { continue }
    if (-not ($e.GetSupportedPatterns() | Where-Object { $_.ProgrammaticName -like "*InvokePattern*" })) { continue }

    $rid = ($e.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '-'
    $info = @{
      rid          = $rid
      name         = $c.Name
      controlType  = $c.ControlType.ProgrammaticName
      automationId = $c.AutomationId
      className    = $c.ClassName
      framework    = $c.FrameworkId
    }

    # Step 2: pattern retrieval, isolated from invocation.
    $pat = $null
    try {
      $pat = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $info.getCurrentPattern = "ok"
    } catch {
      $info.getCurrentPattern = "failed: " + $_.Exception.Message
    }

    if ($null -ne $pat) {
      try {
        $pat.Invoke()
        $info.invokeResult = "invoked"
      } catch {
        $ex = $_.Exception
        $info.invokeResult = "failed"
        $info.invokeErrorType = $ex.GetType().FullName
        $info.invokeErrorMessage = $ex.Message
        if ($ex.InnerException) {
          $info.innerType = $ex.InnerException.GetType().FullName
          $info.innerMessage = $ex.InnerException.Message
          $info.innerHResult = ("0x{0:X8}" -f $ex.InnerException.HResult)
        }
        # Step 4: ONE fresh re-resolve + retry (transient-staleness probe).
        try {
          Start-Sleep -Milliseconds 400
          $sub2 = $win.FindAll([System.Windows.Automation.TreeScope]::Subtree,
            [System.Windows.Automation.Condition]::TrueCondition)
          foreach ($e2 in $sub2) {
            $rid2 = ($e2.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '-'
            if ($rid2 -eq $rid) {
              try {
                $p2 = $e2.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                $p2.Invoke()
                $info.retryAfterReresolve = "invoked"
              } catch {
                $info.retryAfterReresolve = "failed: " + $_.Exception.Message
              }
              break
            }
          }
          if (-not $info.Contains("retryAfterReresolve")) {
            $info.retryAfterReresolve = "element gone from fresh tree"
          }
        } catch {
          $info.retryAfterReresolve = "probe failed: " + $_.Exception.Message
        }
      }
    }
    Send $info
    $tested++
  } catch { continue }
}
[Console]::Out.WriteLine('{"done":true,"tested":' + $tested + '}')
