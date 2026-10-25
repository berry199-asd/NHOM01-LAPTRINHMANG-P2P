$procs = Get-CimInstance Win32_Process -Filter "Name='java.exe'" |
    Where-Object { $_.CommandLine -like '*com.workchat.peer.cli.PeerCoreCli*' }

if (-not $procs) {
    Write-Host "[peer] Khong co Peer Core nao dang chay."
    exit 0
}
foreach ($p in $procs) {
    Write-Host "[peer] Stop PID $($p.ProcessId)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
