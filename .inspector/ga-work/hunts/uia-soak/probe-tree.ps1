param([Parameter(Mandatory = $true)][int]$ProcId)
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$ProcId)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
[Console]::Out.WriteLine("windowsForPid=" + $wins.Count)
if ($wins.Count -eq 0) { exit }
$win = $wins[0]
try {
  [Console]::Out.WriteLine("winName=[" + $win.Current.Name + "] class=[" + $win.Current.ClassName + "] framework=[" + $win.Current.FrameworkId + "]")
} catch {
  [Console]::Out.WriteLine("winPropsFailed: " + $_.Exception.Message)
}
$subtree = $win.FindAll([System.Windows.Automation.TreeScope]::Subtree,
  [System.Windows.Automation.Condition]::TrueCondition)
[Console]::Out.WriteLine("subtreeCount=" + $subtree.Count)
$i = 0
foreach ($e in $subtree) {
  if ($i -ge 8) { break }
  try {
    $c = $e.Current
    $pats = ($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) -join ","
    [Console]::Out.WriteLine("node[$i] type=" + $c.ControlType.ProgrammaticName + " name=[" + $c.Name + "] patterns=[" + $pats + "] framework=" + $c.FrameworkId)
  } catch {
    [Console]::Out.WriteLine("node[$i] propsFailed: " + $_.Exception.Message)
  }
  $i++
}
