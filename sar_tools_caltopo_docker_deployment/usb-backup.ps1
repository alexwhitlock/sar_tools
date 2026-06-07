$source = "$env:USERPROFILE\sar-tools\html_backups"
$label  = "sar-tools-backup"

while ($true) {
    try {
        $vol = Get-WmiObject Win32_Volume | Where-Object { $_.Label -eq $label }
        if ($vol) {
            $dest = $vol.DriveLetter + "\sar-backup"
            robocopy $source $dest /E /MIR /XO /NFL /NDL /NJH /NJS /mon:1
        }
    } catch {
        # swallow errors, keep looping
    }
    Start-Sleep -Seconds 10
}
