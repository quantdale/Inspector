import { spawn, type ChildProcess } from "node:child_process";

/**
 * Line-delimited JSON bridge to a PowerShell UI Automation host.
 *
 * The PowerShell script is passed via -EncodedCommand (UTF-16LE base64) so no
 * quoting ever interpolates into a shell string. Requests and responses travel
 * as single-line JSON over stdin/stdout; every request carries an id and every
 * response echoes it. All operation parameters arrive inside the parsed JSON
 * object — nothing is ever formatted into PowerShell source text.
 */
export const UIA_BRIDGE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = [System.Windows.Automation.AutomationElement]::RootElement
$script:window = $null
$script:attachedPid = 0

function Send-Result($id, $ok, $result, $error) {
  $payload = @{ id = $id; ok = $ok }
  if ($ok) { $payload['result'] = $result } else { $payload['error'] = $error }
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 8))
}

function Test-RuntimeIdEqual($a, $b) {
  if ($a.Length -ne $b.Length) { return $false }
  for ($i = 0; $i -lt $a.Length; $i++) {
    if ($a[$i] -ne $b[$i]) { return $false }
  }
  return $true
}

function Get-WindowCondition {
  return New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window)
}

function Get-TopWindows {
  $wins = @()
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, (Get-WindowCondition))
  foreach ($w in $all) {
    try {
      $c = $w.Current
      if ($c.IsEnabled) {
        $wins += @{ pid = $c.ProcessId; title = $c.Name }
      }
    } catch {}
  }
  return $wins
}

function Test-AttachedAlive {
  if ($null -eq $script:window) { return $false }
  try { $null = $script:window.Current.ProcessId } catch { return $false }
  $p = Get-Process -Id $script:attachedPid -ErrorAction SilentlyContinue
  return ($null -ne $p)
}

# Enumerate every top-level window owned by the given pid, starting from the
# desktop root. Used as the bounded fallback when the cached main-window
# subtree is blocked by a modal dialog: the dialog itself is a top-level
# window of the same process, so this returns the live dialog tree.
function Get-TreeFromDesktopPid($targetPid) {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    [int]$targetPid)
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $nodes = @()
  $max = 800
  foreach ($w in $wins) {
    $subtree = $null
    try {
      $subtree = $w.FindAll([System.Windows.Automation.TreeScope]::Subtree,
        [System.Windows.Automation.Condition]::TrueCondition)
    } catch { continue }
    foreach ($e in $subtree) {
      if ($nodes.Count -ge $max) { break }
      try { $nodes += (Get-NodeInfo $e) } catch {}
    }
    if ($nodes.Count -ge $max) { break }
  }
  return $nodes
}

function Get-ElementByRuntimeId($ridString) {
  if ($null -eq $script:window) { throw 'STALE_ELEMENT: no attached window' }
  $rid = $ridString -split '-' | ForEach-Object { [int]$_ }
  $all = $null
  try {
    $all = $script:window.FindAll([System.Windows.Automation.TreeScope]::Subtree,
      [System.Windows.Automation.Condition]::TrueCondition)
  } catch {
    throw 'STALE_ELEMENT: attached window is gone'
  }
  foreach ($e in $all) {
    if (Test-RuntimeIdEqual ($e.GetRuntimeId()) $rid) { return $e }
  }
  throw ('STALE_ELEMENT: runtime id not found in current tree: ' + $ridString)
}

function Get-Pattern($e, $pattern, $name) {
  try {
    return $e.GetCurrentPattern($pattern)
  } catch {
    throw ('PATTERN_UNSUPPORTED: ' + $name)
  }
}

function Get-NodeInfo($e) {
  $patterns = @()
  foreach ($p in $e.GetSupportedPatterns()) { $patterns += $p.ProgrammaticName }
  $rect = $null
  try {
    $r = $e.Current.BoundingRectangle
    if (-not $r.IsEmpty) {
      $rect = @{ x = [double]$r.X; y = [double]$r.Y; w = [double]$r.Width; h = [double]$r.Height }
    }
  } catch {}
  $rid = ($e.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '-'
  $c = $e.Current
  return @{
    id = $rid
    type = $c.ControlType.ProgrammaticName.Replace('ControlType.', '')
    name = $c.Name
    automationId = $c.AutomationId
    enabled = [bool]$c.IsEnabled
    offscreen = [bool]$c.IsOffscreen
    rect = $rect
    patterns = $patterns
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    $result = $null
    switch ($req.op) {
      'ping' {
        $result = 'pong'
      }
      'listWindows' {
        $result = Get-TopWindows
      }
      'attach' {
        $matchPid = $req.params.pid
        $title = $req.params.titleContains
        $found = $null
        foreach ($w in (Get-TopWindows)) {
          if ($matchPid -and ($w.pid -eq $matchPid)) { $found = $w; break }
          if ($title -and ($w.title -like ('*' + $title + '*'))) { $found = $w; break }
        }
        if ($null -eq $found) { throw 'WINDOW_NOT_FOUND' }
        $cond = New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
          [int]$found.pid)
        $candidates = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
        $winEl = $null
        foreach ($cand in $candidates) {
          if ((Test-RuntimeIdEqual ($cand.GetRuntimeId()) @()) -eq $true) { continue }
          $winEl = $cand
          break
        }
        if ($null -eq $winEl) { throw 'WINDOW_NOT_FOUND' }
        $script:window = $winEl
        $script:attachedPid = $found.pid
        $result = Get-NodeInfo $winEl
      }
      'detach' {
        $script:window = $null
        $script:attachedPid = 0
        $result = $true
      }
      'tree' {
        if ($null -eq $script:window) { throw 'NO_ATTACHED_WINDOW' }
        # Liveness gate: never return a stale/cached tree for a dead target.
        if (-not (Test-AttachedAlive)) {
          throw ('DEAD_WINDOW: attached pid ' + $script:attachedPid + ' is not running')
        }
        # Modal probe: when the main window is blocked by a modal dialog its
        # own subtree stops responding, so fall back to enumerating from the
        # desktop root scoped to the attached pid (returns the dialog tree).
        $scopeEl = $script:window
        $modalBlocking = $false
        try {
          $wp = $script:window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
          if ($wp.Current.WindowInteractionState -eq
            [System.Windows.Automation.WindowInteractionState]::BlockedByModalWindow) {
            $modalBlocking = $true
          }
        } catch {}
        $nodes = @()
        if ($modalBlocking) {
          $nodes = Get-TreeFromDesktopPid $script:attachedPid
        } else {
          $all = $null
          try {
            $all = $scopeEl.FindAll([System.Windows.Automation.TreeScope]::Subtree,
              [System.Windows.Automation.Condition]::TrueCondition)
          } catch {
            throw 'STALE_ELEMENT: attached window is gone'
          }
          $max = 800
          $i = 0
          foreach ($e in $all) {
            if ($i -ge $max) { break }
            try { $nodes += (Get-NodeInfo $e) } catch {}
            $i++
          }
        }
        $result = @{ pid = $script:attachedPid; nodes = $nodes; modalBlocking = $modalBlocking }
      }
      'treeDesktop' {
        # Bounded desktop-root enumeration scoped to a pid; used by the
        # backend as fallback when the primary tree op times out.
        $targetPid = [int]$req.params.pid
        if ($targetPid -le 0) { throw 'VALIDATION: pid required' }
        $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        if ($null -eq $p) { throw ('DEAD_WINDOW: pid ' + $targetPid + ' is not running') }
        $nodes = Get-TreeFromDesktopPid $targetPid
        $result = @{ pid = $targetPid; nodes = $nodes; modalBlocking = $true }
      }
      'invoke' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.InvokePattern]::Pattern) 'Invoke'
        $pat.Invoke()
        $result = $true
      }
      'toggle' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.TogglePattern]::Pattern) 'Toggle'
        $pat.Toggle()
        $result = $true
      }
      'expandCollapse' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.ExpandCollapsePattern]::Pattern) 'ExpandCollapse'
        if ($req.params.action -eq 'collapse') { $pat.Collapse() } else { $pat.Expand() }
        $result = $true
      }
      'setValue' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.ValuePattern]::Pattern) 'Value'
        $pat.SetValue([string]$req.params.value)
        $result = $true
      }
      'select' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.SelectionItemPattern]::Pattern) 'SelectionItem'
        $pat.Select()
        $result = $true
      }
      'readValue' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $value = $e.Current.Name
        try {
          $pat = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          $value = $pat.Current.Value
        } catch {}
        $result = @{ value = $value }
      }
      'readToggleState' {
        $e = Get-ElementByRuntimeId $req.params.rid
        $pat = Get-Pattern $e ([System.Windows.Automation.TogglePattern]::Pattern) 'Toggle'
        $result = @{ state = [string]$pat.Current.ToggleState }
      }
      'closeWindow' {
        if ($null -eq $script:window) { throw 'NO_ATTACHED_WINDOW' }
        $pat = Get-Pattern $script:window ([System.Windows.Automation.WindowPattern]::Pattern) 'Window'
        $pat.Close()
        $result = $true
      }
      'windowStatus' {
        $alive = Test-AttachedAlive
        $result = @{ alive = $alive; pid = $script:attachedPid }
      }
      default {
        throw ('UNKNOWN_OP: ' + $req.op)
      }
    }
    Send-Result $req.id $true $result $null
  } catch {
    $errId = $null
    if ($null -ne $req) { $errId = $req.id }
    Send-Result $errId $false $null $_.Exception.Message
  }
}
`;

export interface BridgeOptions {
  /** Per-operation timeout in milliseconds. Default 5000. */
  timeoutMs?: number;
  powershellPath?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class PowerShellUiaBridge {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private buffer = "";
  private stderrTail: string[] = [];
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timeoutMs: number;
  private readonly powershellPath: string;
  private disposed = false;
  /** PID of the spawned host, retained after dispose for orphan checks. */
  private lastPid: number | null = null;

  constructor(opts: BridgeOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.powershellPath = opts.powershellPath ?? "powershell.exe";
  }

  /** PID of the spawned PowerShell host (retained after dispose), or null. */
  get childPid(): number | null {
    return this.child?.pid ?? this.lastPid;
  }

  private ensureStarted(): ChildProcess {
    if (this.child) return this.child;
    if (this.disposed) throw new Error("bridge disposed");
    const encoded = Buffer.from(UIA_BRIDGE_SCRIPT, "utf16le").toString("base64");
    const child = spawn(
      this.powershellPath,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    this.child = child;
    this.lastPid = child.pid ?? null;

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrTail.push(chunk);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });
    child.on("exit", () => this.failAllPending(new Error("UIA bridge exited unexpectedly")));
    child.on("error", (err) => this.failAllPending(err));
    return child;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      this.onMessage(line);
    }
  }

  private onMessage(line: string): void {
    let msg: { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // ignore malformed lines; never crash the pump
    }
    const id = typeof msg.id === "string" ? msg.id : undefined;
    if (id === undefined) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (msg.ok === true) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new Error(String(msg.error ?? "unknown bridge error")));
    }
  }

  private failAllPending(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  async request<T>(op: string, params?: Record<string, unknown>): Promise<T> {
    const child = this.ensureStarted();
    const id = String(this.nextId++);
    const line = JSON.stringify({ id, op, params: params ?? {} }) + "\n";
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`UIA bridge timeout after ${this.timeoutMs}ms (op=${op})`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        child.stdin?.write(line);
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** Kill the PowerShell host and reject everything still in flight. */
  dispose(): void {
    this.disposed = true;
    this.failAllPending(new Error("bridge disposed"));
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      /* stdin already closed */
    }
    // Escalate: graceful kill first, then force. Windows has no SIGTERM
    // semantics for this, so taskkill /T catches any grandchildren.
    try {
      child.kill();
    } catch {
      /* already dead */
    }
    const pid = child.pid;
    setTimeout(() => {
      try {
        if (pid) spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      } catch {
        /* best-effort reaping */
      }
    }, 1500).unref?.();
  }

  /** Recent stderr output from the PowerShell host, for diagnostics. */
  recentStderr(): string {
    return this.stderrTail.join("");
  }
}
